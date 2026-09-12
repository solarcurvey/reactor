/**
 * Canonical Top-10 epoch candidates.
 * Reads graduated markets + persisted `current_supply` + window trades from the indexer store.
 * Values quotes through ValuationService ancestry. Never RPCs. Never invents a 0.30% pool.
 * Never sums SelfBurnExecuted / Top10Buy — those are attribution, not circulating supply.
 */
import {
  MARK_WINDOW_SEC,
  TOP10_FLOOR_USDC,
  TOP10_SNAPSHOT_TTL_SEC,
  acceptTop10Snapshot,
  isCoreToken,
  isSnapshotFresh,
  lastGoodPriceQuoteX18,
  rankTop10,
  snapshotAgeSec,
  staleSnapshotReason,
  vwapPriceQuoteX18,
  type PriceSample,
  type RankCandidate,
  type RankRow,
} from "../../../packages/reactor/src/top10.ts";
import { fdvUsd6 } from "../../../packages/reactor/src/prices.ts";
import { loadValuationService } from "./valuation-store.ts";
import type { Store } from "./db.ts";

export const CURRENT_EPOCH_ID = "current";
export const TOP10_SOURCE = "valuation-service" as const;

export const TOP10_TRUST =
  "Not a trustless oracle. Indexer ValuationService ranks graduated markets from persisted state; designated Keeper publishes epoch; onchain verifies structure only.";

export type Top10EpochPayload = {
  source: typeof TOP10_SOURCE;
  pauseEpoch: boolean;
  reason: string;
  rows: RankRow[];
  candidates: number;
  floorUsdc: string;
  computedTs: number;
  nowSec: number;
  epochId: string;
  trust: string;
};

export type Top10RankOpts = {
  coreAddresses: readonly string[];
  nowSec?: number;
  floorUsdc?: bigint;
};

export { TOP10_SNAPSHOT_TTL_SEC, acceptTop10Snapshot, isSnapshotFresh, staleSnapshotReason };

function asBigInt(v: unknown): bigint {
  try {
    const s = String(v ?? "0").split(".")[0] ?? "0";
    return s ? BigInt(s) : 0n;
  } catch {
    return 0n;
  }
}

function groupSamples(rows: Array<{ token: string; notional_quote: string; price_quote_x18: string; ts: number }>): Map<string, PriceSample[]> {
  const out = new Map<string, PriceSample[]>();
  for (const r of rows) {
    const token = r.token.toLowerCase();
    const list = out.get(token) ?? [];
    list.push({
      notional: asBigInt(r.notional_quote),
      priceQuoteX18: asBigInt(r.price_quote_x18),
      ts: Number(r.ts ?? 0),
    });
    out.set(token, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.ts - b.ts);
  return out;
}

/** Graduated official markets only. Bonding / ungraduated Fair never enter the candidate set. */
export async function loadGraduatedMarkets(store: Store): Promise<
  Array<{
    token: string;
    quote: string;
    symbol: string;
    ticker: string;
    circulating: bigint;
    supplyKnown: boolean;
    decimals: number;
    quoteDecimals: number;
    priceQuoteX18: bigint;
    fdvUsd6: bigint;
    liquidityQuote: bigint;
  }>
> {
  const rows = await store.all<{
    token: string;
    quote: string;
    symbol: string;
    ticker: string;
    circulating: string | null;
    decimals: number;
    quote_decimals: number;
    price_quote_x18: string;
    fdv_usd6: string;
    liquidity_quote: string;
  }>(
    `SELECT m.token, m.quote, m.price_quote_x18, m.fdv_usd6,
            COALESCE(t.symbol,'') as symbol, COALESCE(t.ticker,'') as ticker,
            t.current_supply as circulating,
            COALESCE(t.decimals,18) as decimals,
            COALESCE(q.decimals,6) as quote_decimals,
            COALESCE(NULLIF(g.quote_lp,''), NULLIF(m.real_quote,''), '0') as liquidity_quote
     FROM markets m
     LEFT JOIN tokens t ON t.address = m.token
     LEFT JOIN quote_assets q ON q.token = m.quote
     LEFT JOIN graduations g ON g.token = m.token
     WHERE m.market_live = 1
        OR m.stage = 'v4'
        OR EXISTS (SELECT 1 FROM graduations g2 WHERE g2.token = m.token)`,
  );
  return rows.map((r) => {
    const raw = r.circulating;
    const supplyKnown = raw != null && String(raw).trim() !== "";
    return {
      token: r.token.toLowerCase(),
      quote: (r.quote ?? "").toLowerCase(),
      symbol: r.symbol || r.token.slice(0, 6),
      ticker: (r.ticker ?? "").toUpperCase(),
      circulating: supplyKnown ? asBigInt(raw) : 0n,
      supplyKnown,
      decimals: Number(r.decimals ?? 18),
      quoteDecimals: Number(r.quote_decimals ?? 6),
      priceQuoteX18: asBigInt(r.price_quote_x18),
      fdvUsd6: asBigInt(r.fdv_usd6),
      liquidityQuote: asBigInt(r.liquidity_quote),
    };
  });
}

export async function loadPriorRanked(store: Store): Promise<Set<string>> {
  const rows = await store.all<{ token: string }>(
    `SELECT token FROM top10_candidate_rows WHERE epoch_id=?
     UNION
     SELECT token FROM targets`,
    CURRENT_EPOCH_ID,
  );
  return new Set(rows.map((r) => r.token.toLowerCase()));
}

export async function computeTop10Epoch(store: Store, opts: Top10RankOpts): Promise<Top10EpochPayload> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const floorUsdc = opts.floorUsdc ?? TOP10_FLOOR_USDC;
  const computedTs = nowSec;
  const markets = await loadGraduatedMarkets(store);
  const prior = await loadPriorRanked(store);
  const windowFrom = nowSec - MARK_WINDOW_SEC;
  const histFrom = nowSec - 2 * MARK_WINDOW_SEC;
  const [windowRows, histRows] = await Promise.all([
    store.all<{ token: string; notional_quote: string; price_quote_x18: string; ts: number }>(
      `SELECT lower(token) as token, notional_quote, price_quote_x18, ts
       FROM trades
       WHERE ts>=? AND ts<=? AND price_quote_x18 IS NOT NULL AND price_quote_x18!='0'`,
      windowFrom,
      nowSec,
    ),
    store.all<{ token: string; notional_quote: string; price_quote_x18: string; ts: number }>(
      `SELECT lower(token) as token, notional_quote, price_quote_x18, ts
       FROM trades
       WHERE ts>=? AND ts<? AND price_quote_x18 IS NOT NULL AND price_quote_x18!='0'`,
      histFrom,
      windowFrom,
    ),
  ]);
  const windowByToken = groupSamples(windowRows);
  const histByToken = groupSamples(histRows);
  const svc = await loadValuationService(store);

  const missingSupply = markets.some((m) => {
    const core = isCoreToken(m.token, opts.coreAddresses) || m.ticker === "CORE" || m.symbol.toUpperCase() === "CORE";
    return !core && !m.supplyKnown;
  });
  if (missingSupply) {
    return failClosedTop10(
      "current_supply missing after schema v9 — pause epoch, never mint-supply fallback",
      nowSec,
    );
  }

  const cands: RankCandidate[] = [];
  for (const m of markets) {
    const core = isCoreToken(m.token, opts.coreAddresses) || m.ticker === "CORE" || m.symbol.toUpperCase() === "CORE";
    const circulating = m.circulating;
    const window = windowByToken.get(m.token) ?? [];
    const hist = histByToken.get(m.token) ?? [];
    const vwap = vwapPriceQuoteX18(window, nowSec);
    const quoteVal = m.quote ? svc.quoteUsd6(m.quote) : { ok: false, usd6: 0n, reason: "missing quote", ancestry: [] };
    const toUsdc = (priceX18: bigint) =>
      quoteVal.ok && circulating > 0n && priceX18 > 0n ? fdvUsd6(priceX18, circulating, m.decimals, quoteVal.usd6) : 0n;
    const windowVolumeUsdc = quoteVal.ok
      ? window.reduce((a, s) => a + (s.notional * quoteVal.usd6) / 10n ** BigInt(m.quoteDecimals), 0n)
      : 0n;
    const lastGoodPx = lastGoodPriceQuoteX18(hist, nowSec);
    const lastGoodMarkUsdc = toUsdc(lastGoodPx) || (quoteVal.ok ? m.fdvUsd6 : 0n);
    const liquidityUsdc =
      quoteVal.ok && m.liquidityQuote > 0n
        ? (m.liquidityQuote * quoteVal.usd6) / 10n ** BigInt(m.quoteDecimals)
        : 0n;
    let markUsdc = 0n;
    let markOk = false;
    if (!core && quoteVal.ok && vwap.ok) {
      markUsdc = toUsdc(vwap.priceX18);
      markOk = markUsdc > 0n;
    }
    cands.push({
      token: m.token,
      symbol: m.symbol,
      quote: m.quote,
      graduated: true,
      isCore: core,
      markUsdc,
      markOk,
      lastGoodMarkUsdc,
      tradeCount: window.length + hist.length,
      liquidityUsdc,
      windowVolumeUsdc,
      priorRanked: prior.has(m.token),
    });
  }

  const ranked = rankTop10(cands, floorUsdc);
  const reason = ranked.pauseEpoch
    ? ranked.pauseReason ?? "material candidate unvalued — pause epoch, never guess"
    : ranked.rows.length === 0
      ? "no graduated names with a defensible 10–15m VWAP ≥ $250k"
      : "canonical ValuationService ranks from indexed 12m VWAP + persisted current_supply";
  return {
    source: TOP10_SOURCE,
    pauseEpoch: ranked.pauseEpoch,
    reason,
    rows: ranked.rows,
    candidates: cands.length,
    floorUsdc: floorUsdc.toString(),
    computedTs,
    nowSec,
    epochId: CURRENT_EPOCH_ID,
    trust: TOP10_TRUST,
  };
}

export async function persistTop10Epoch(store: Store, payload: Top10EpochPayload): Promise<void> {
  await store.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO top10_candidate_epochs(id,computed_ts,now_sec,pause_epoch,reason,candidates,source,payload)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         computed_ts=excluded.computed_ts,
         now_sec=excluded.now_sec,
         pause_epoch=excluded.pause_epoch,
         reason=excluded.reason,
         candidates=excluded.candidates,
         source=excluded.source,
         payload=excluded.payload`,
      payload.epochId,
      payload.computedTs,
      payload.nowSec,
      payload.pauseEpoch ? 1 : 0,
      payload.reason,
      payload.candidates,
      payload.source,
      JSON.stringify(payload),
    );
    await tx.run("DELETE FROM top10_candidate_rows WHERE epoch_id=?", payload.epochId);
    for (const row of payload.rows) {
      await tx.run(
        `INSERT INTO top10_candidate_rows(epoch_id,rank,token,symbol,quote,mark_usdc,weight_bps)
         VALUES(?,?,?,?,?,?,?)`,
        payload.epochId,
        row.rank,
        row.token.toLowerCase(),
        row.symbol,
        row.quote,
        row.markUsdc,
        row.weightBps,
      );
    }
  });
}

export async function readTop10Epoch(store: Store): Promise<Top10EpochPayload | undefined> {
  const row = await store.get<{ payload: string }>("SELECT payload FROM top10_candidate_epochs WHERE id=?", CURRENT_EPOCH_ID);
  if (!row?.payload) return undefined;
  try {
    return JSON.parse(row.payload) as Top10EpochPayload;
  } catch {
    return undefined;
  }
}

export async function refreshTop10Epoch(store: Store, opts: Top10RankOpts): Promise<Top10EpochPayload> {
  const payload = await computeTop10Epoch(store, opts);
  await persistTop10Epoch(store, payload);
  return payload;
}

/** Persist a paused snapshot when refresh throws so GET /top10 cannot keep serving the last healthy payload. */
export async function persistPausedTop10(store: Store, reason: string, nowSec?: number): Promise<Top10EpochPayload> {
  const payload = failClosedTop10(reason, nowSec);
  await persistTop10Epoch(store, payload);
  return payload;
}

/**
 * GET /top10 serve path. Fresh persisted snapshots are returned as-is.
 * Stale or missing snapshots refresh; a failed refresh pauses (never the old healthy payload).
 */
export async function resolveTop10Serve(args: {
  persisted: Top10EpochPayload | undefined;
  nowSec: number;
  refresh: () => Promise<Top10EpochPayload>;
}): Promise<Top10EpochPayload> {
  if (args.persisted && isSnapshotFresh(args.persisted.computedTs, args.nowSec)) {
    return args.persisted;
  }
  try {
    return await args.refresh();
  } catch (e) {
    const age = args.persisted ? snapshotAgeSec(args.persisted.computedTs, args.nowSec) : Number.POSITIVE_INFINITY;
    const reason = args.persisted
      ? staleSnapshotReason(age)
      : e instanceof Error
        ? e.message
        : "top10 refresh failed — epoch paused";
    return failClosedTop10(reason, args.nowSec);
  }
}

export function coreAddressesFromDeployment(addrs: Record<string, string | undefined>): string[] {
  return [addrs.CoreToken, addrs.TestCORE].filter((a): a is string => Boolean(a));
}

export function failClosedTop10(reason: string, nowSec = Math.floor(Date.now() / 1000)): Top10EpochPayload {
  return {
    source: TOP10_SOURCE,
    pauseEpoch: true,
    reason,
    rows: [],
    candidates: 0,
    floorUsdc: TOP10_FLOOR_USDC.toString(),
    computedTs: nowSec,
    nowSec,
    epochId: CURRENT_EPOCH_ID,
    trust: "Fail closed. Keeper must skip this epoch.",
  };
}
