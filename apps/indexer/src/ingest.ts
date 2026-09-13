import type { Store } from "./db.ts";
import {
  applyTradeToCandle,
  CANDLE_INTERVALS,
  burnAdjustedSupply,
  fdvUsd6,
  priceQuoteX18,
} from "../../../packages/reactor/src/prices.ts";
import { EVENT_IDENTITY_CONFLICT, insertLogOnce, journalEvent } from "./event-identity.ts";
import { isUniqueViolation } from "./unique.ts";
import { loadValuationService } from "./valuation-store.ts";
import { change24hBps, quoteLiquidityUsd6 } from "./markets-metrics.ts";

export type SsePublisher = { publish(ev: { type: string; data: unknown }): void };
export type TotalSupplyReader = (token: string) => Promise<bigint | null>;

const INTERVALS = Object.values(CANDLE_INTERVALS);

export async function upsertToken(
  store: Store,
  row: {
    address: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    creator?: string;
    quote?: string;
    mode?: number;
    rewardsMode?: boolean;
    supply?: string;
    currentSupply?: string;
    ticker?: string;
    factoryVersion?: number;
    block?: number;
    tx?: string;
    ts?: number;
  },
) {
  const initial = row.supply ?? "";
  const current = row.currentSupply ?? initial;
  await store.run(
    `INSERT INTO tokens(address,symbol,name,decimals,creator,quote,mode,rewards_mode,supply,current_supply,ticker,factory_version,created_block,created_tx,created_ts)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(address) DO UPDATE SET
       symbol=COALESCE(excluded.symbol,tokens.symbol),
       quote=COALESCE(excluded.quote,tokens.quote),
       ticker=COALESCE(NULLIF(excluded.ticker,''),tokens.ticker),
       supply=COALESCE(NULLIF(excluded.supply,''),tokens.supply),
       current_supply=CASE
         WHEN tokens.current_supply IS NULL OR tokens.current_supply='' THEN COALESCE(NULLIF(excluded.current_supply,''), NULLIF(excluded.supply,''), tokens.supply)
         ELSE tokens.current_supply
       END`,
    row.address.toLowerCase(),
    row.symbol ?? "",
    row.name ?? "",
    row.decimals ?? 18,
    row.creator ?? "",
    (row.quote ?? "").toLowerCase(),
    row.mode ?? 0,
    row.rewardsMode === false ? 0 : 1,
    initial,
    current,
    row.ticker ?? row.symbol ?? "",
    row.factoryVersion ?? 1,
    row.block ?? 0,
    row.tx ?? "",
    row.ts ?? 0,
  );
}

function parseRaw(v: string | undefined): bigint {
  try {
    return BigInt(String(v || "0").split(".")[0] ?? "0");
  } catch {
    return 0n;
  }
}

/** Stored remaining-supply snapshot. Never TokenCreated minus SelfBurn/Top10/COREBurned. */
export async function currentSupplyRaw(store: Store, token: string): Promise<bigint> {
  const tok = await store.get<{ supply: string; current_supply: string }>(
    "SELECT supply, current_supply FROM tokens WHERE address=?",
    token.toLowerCase(),
  );
  const current = parseRaw(tok?.current_supply);
  if (current > 0n || (tok?.current_supply !== undefined && tok.current_supply !== "" && tok.current_supply !== null)) {
    return parseRaw(tok?.current_supply);
  }
  return parseRaw(tok?.supply);
}

/** Authoritative writer: onchain `totalSupply()` wins over event attribution. */
export async function applyOnchainTotalSupply(store: Store, token: string, totalSupply: bigint): Promise<bigint> {
  const addr = token.toLowerCase();
  const existing = await store.get<{ address: string }>("SELECT address FROM tokens WHERE address=?", addr);
  if (!existing) {
    await upsertToken(store, { address: addr, supply: totalSupply.toString(), currentSupply: totalSupply.toString() });
  }
  await store.run("UPDATE tokens SET current_supply=? WHERE address=?", totalSupply.toString(), addr);
  return totalSupply;
}

/**
 * Token-level `Burned` / `Transfer` to zero. Deduped by canonical
 * `(chain_id, tx, log_index, event_kind)` — Transfer and Burned in one tx are two logs.
 * Protocol SelfBurn/Top10 are attribution only and do not write current_supply.
 * Multiple same-tx burns are corrected by `totalSupply()` reconcile.
 */
export async function applyTokenLevelBurn(
  store: Store,
  row: {
    token: string;
    burned: string;
    block: number;
    tx: string;
    ts: number;
    account?: string;
    chainId: number;
    logIndex: number;
    eventKind: string;
  },
): Promise<boolean> {
  const token = row.token.toLowerCase();
  const eventKind = row.eventKind;
  const claimed = await journalEvent(store, {
    chainId: row.chainId,
    tx: row.tx,
    logIndex: row.logIndex,
    eventKind,
    address: token,
    block: row.block,
    ts: row.ts,
  });
  const inserted = await insertLogOnce(
    store,
    `INSERT INTO selfburn(token,quote,amount,burned,kind,block,tx,ts,chain_id,log_index,event_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ${EVENT_IDENTITY_CONFLICT}`,
    token,
    "",
    row.account ?? "0",
    row.burned,
    eventKind,
    row.block,
    row.tx,
    row.ts,
    row.chainId,
    row.logIndex,
    eventKind,
  );
  if (!claimed && !inserted) return false;
  const remaining = burnAdjustedSupply(await currentSupplyRaw(store, token), parseRaw(row.burned));
  await store.run("UPDATE tokens SET current_supply=? WHERE address=?", remaining.toString(), token);
  return true;
}

/** Attribution only. Never writes current_supply. */
export async function persistSupplyBurn(
  store: Store,
  row: {
    token: string;
    quote?: string;
    amount?: string;
    burned: string;
    kind: string;
    block: number;
    tx: string;
    ts: number;
    chainId?: number;
    logIndex?: number;
  },
): Promise<boolean> {
  const chainId = row.chainId ?? 0;
  const logIndex = row.logIndex ?? 0;
  const token = row.token.toLowerCase();
  const claimed = await journalEvent(store, {
    chainId,
    tx: row.tx,
    logIndex,
    eventKind: row.kind,
    address: token,
    block: row.block,
    ts: row.ts,
  });
  const inserted = await insertLogOnce(
    store,
    `INSERT INTO selfburn(token,quote,amount,burned,kind,block,tx,ts,chain_id,log_index,event_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ${EVENT_IDENTITY_CONFLICT}`,
    token,
    (row.quote ?? "").toLowerCase(),
    row.amount ?? "0",
    row.burned,
    row.kind,
    row.block,
    row.tx,
    row.ts,
    chainId,
    logIndex,
    row.kind,
  );
  return claimed || inserted;
}

/** Bounded totalSupply() backfill. Priority tokens (CORE, just-burned) plus a rotating page. */
export async function reconcileCurrentSupplies(
  store: Store,
  readTotalSupply: TotalSupplyReader,
  opts?: { limit?: number; after?: string; priority?: string[] },
): Promise<{ reconciled: number; nextCursor: string }> {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 40));
  const after = (opts?.after ?? "").toLowerCase();
  const page = await store.all<{ address: string }>(
    after
      ? "SELECT address FROM tokens WHERE address > ? ORDER BY address ASC LIMIT ?"
      : "SELECT address FROM tokens ORDER BY address ASC LIMIT ?",
    ...(after ? [after, limit] : [limit]),
  );
  const want = new Set<string>();
  for (const p of opts?.priority ?? []) {
    if (p) want.add(p.toLowerCase());
  }
  for (const r of page) want.add(r.address.toLowerCase());
  let reconciled = 0;
  for (const addr of want) {
    const onchain = await readTotalSupply(addr);
    if (onchain === null || onchain === undefined) continue;
    await applyOnchainTotalSupply(store, addr, onchain);
    reconciled += 1;
  }
  const nextCursor = page.length < limit ? "" : (page[page.length - 1]?.address ?? "");
  return { reconciled, nextCursor };
}

export async function upsertMarket(
  store: Store,
  row: {
    token: string;
    quote?: string;
    poolId?: string;
    stage?: string;
    marketLive?: boolean;
    fairId?: string;
    bondingBps?: number;
    realQuote?: string;
    gradTarget?: string;
    image?: string;
    description?: string;
    ts?: number;
  },
) {
  const token = row.token.toLowerCase();
  const existing = await store.get<{ token: string }>("SELECT token FROM markets WHERE token=?", token);
  if (!existing) {
    await store.run(
      `INSERT INTO markets(token,quote,pool_id,stage,market_live,fair_id,bonding_bps,real_quote,grad_target,price_quote_x18,price_usd6,fdv_usd6,volume_24h_quote,volume_24h_usd6,trades_24h,lifetime_rewards,image,description,updated_ts)
       VALUES(?,?,?,?,?,?,?,?,?,'0','0','0','0','0',0,'0',?,?,?)`,
      token,
      (row.quote ?? "").toLowerCase(),
      row.poolId ?? "",
      row.stage ?? "bonding",
      row.marketLive ? 1 : 0,
      row.fairId ?? "0",
      row.bondingBps ?? 0,
      row.realQuote ?? "0",
      row.gradTarget ?? "0",
      row.image ?? "",
      row.description ?? "",
      row.ts ?? 0,
    );
    return;
  }
  await store.run(
    `UPDATE markets SET
      quote=COALESCE(NULLIF(?,''),quote),
      pool_id=COALESCE(NULLIF(?,''),pool_id),
      stage=COALESCE(NULLIF(?,''),stage),
      market_live=CASE WHEN ?=1 THEN 1 ELSE market_live END,
      bonding_bps=COALESCE(?,bonding_bps),
      real_quote=COALESCE(NULLIF(?,''),real_quote),
      grad_target=COALESCE(NULLIF(?,''),grad_target),
      image=COALESCE(NULLIF(?,''),image),
      description=COALESCE(NULLIF(?,''),description),
      updated_ts=?
     WHERE token=?`,
    (row.quote ?? "").toLowerCase(),
    row.poolId ?? "",
    row.stage ?? "",
    row.marketLive ? 1 : 0,
    row.bondingBps ?? null,
    row.realQuote ?? "",
    row.gradTarget ?? "",
    row.image ?? "",
    row.description ?? "",
    row.ts ?? Date.now() / 1000,
    token,
  );
}

export async function recordTrade(
  store: Store,
  sse: SsePublisher | undefined,
  t: {
    block: number;
    tx: string;
    logIndex?: number;
    chainId?: number;
    eventKind?: string;
    address?: string;
    token: string;
    quote: string;
    side: string;
    source: "curve" | "v4";
    amountIn: string;
    amountOut: string;
    notionalQuote: string;
    priceQuoteX18: string;
    sqrtPrice?: string;
    holders?: string;
    flywheel?: string;
    core?: string;
    ts: number;
    tokenDecimals?: number;
    quoteDecimals?: number;
  },
) {
  const token = t.token.toLowerCase();
  const logIndex = t.logIndex ?? 0;
  const chainId = t.chainId ?? 0;
  const eventKind =
    t.eventKind ??
    (t.source === "v4" ? "SwapFeeAccrued" : t.side === "buy" ? "CurveBuy" : t.side === "sell" ? "CurveSell" : "Trade");
  await journalEvent(store, {
    chainId,
    tx: t.tx,
    logIndex,
    eventKind,
    address: t.address ?? token,
    block: t.block,
    ts: t.ts,
  });
  try {
    const inserted = await store.runChanges(
      `INSERT INTO trades(chain_id,block,tx,log_index,token,quote,side,source,amount_in,amount_out,notional_quote,price_quote_x18,sqrt_price,holders_fee,flywheel_fee,core_fee,ts)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(chain_id, tx, log_index) DO NOTHING`,
      chainId,
      t.block,
      t.tx,
      logIndex,
      token,
      t.quote.toLowerCase(),
      t.side,
      t.source,
      t.amountIn,
      t.amountOut,
      t.notionalQuote,
      t.priceQuoteX18,
      t.sqrtPrice ?? "",
      t.holders ?? "0",
      t.flywheel ?? "0",
      t.core ?? "0",
      t.ts,
    );
    if (inserted.changes === 0) return;
  } catch (e) {
    if (isUniqueViolation(e)) return;
    throw e;
  }

  if (t.priceQuoteX18 && t.priceQuoteX18 !== "0") {
    for (const sec of INTERVALS) {
      const prev = await store.get<{ t: number; o: string; h: string; l: string; c: string; v: string; n: number }>(
        "SELECT t,o,h,l,c,v,n FROM candles WHERE token=? AND interval_sec=? AND t=?",
        token,
        sec,
        Math.floor(t.ts / sec) * sec,
      );
      const next = applyTradeToCandle(prev, t.ts, sec, t.priceQuoteX18, t.notionalQuote);
      await store.run(
        `INSERT INTO candles(token,interval_sec,t,o,h,l,c,v,n) VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(token,interval_sec,t) DO UPDATE SET h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v, n=excluded.n`,
        token,
        sec,
        next.t,
        next.o,
        next.h,
        next.l,
        next.c,
        next.v,
        next.n,
      );
    }
    await store.run(
      "UPDATE markets SET price_quote_x18=?, updated_ts=? WHERE token=?",
      t.priceQuoteX18,
      t.ts,
      token,
    );
    await applyIncrementalTrade(store, token, t.notionalQuote, "0", t.ts);
    await expireOldWindow(store, token, t.ts);
    await rollOneMarket(store, token, t.ts);
  }
  sse?.publish({
    type: "trade",
    data: { token, quote: t.quote, source: t.source, price_quote_x18: t.priceQuoteX18, ts: t.ts, tx: t.tx },
  });
}

export function curvePriceX18(quoteRaw: string, tokenRaw: string, quoteDecimals: number, tokenDecimals: number): string {
  try {
    return priceQuoteX18(BigInt(quoteRaw || "0"), BigInt(tokenRaw || "0"), quoteDecimals, tokenDecimals).toString();
  } catch {
    return "0";
  }
}

export async function upsertOfficialPool(
  store: Store,
  row: {
    poolId: string;
    token: string;
    quote: string;
    factory?: string;
    mode?: number;
    hook?: string;
    block: number;
    tx: string;
    ts: number;
  },
) {
  if (!row.poolId) return;
  await store.run(
    `INSERT INTO official_pools(pool_id,token,quote,factory,mode,hook,block,tx,ts)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(pool_id) DO UPDATE SET
       token=COALESCE(NULLIF(excluded.token,''),official_pools.token),
       quote=COALESCE(NULLIF(excluded.quote,''),official_pools.quote),
       factory=COALESCE(NULLIF(excluded.factory,''),official_pools.factory),
       mode=excluded.mode,
       hook=COALESCE(NULLIF(excluded.hook,''),official_pools.hook),
       block=excluded.block,
       tx=excluded.tx,
       ts=excluded.ts`,
    row.poolId,
    row.token.toLowerCase(),
    row.quote.toLowerCase(),
    (row.factory ?? "").toLowerCase(),
    row.mode ?? 0,
    row.hook ?? "",
    row.block,
    row.tx,
    row.ts,
  );
}

function numericSum(sqlDialect: "sqlite" | "postgres"): string {
  return sqlDialect === "postgres"
    ? "COALESCE(SUM(CAST(notional_quote AS NUMERIC)),0)"
    : "COALESCE(SUM(CAST(notional_quote AS NUMERIC)),0)";
}

export async function rollOneMarket(store: Store, token: string, nowTs: number) {
  const since = nowTs - 86_400;
  const agg = await store.get<{ n: number; vol: string }>(
    `SELECT COUNT(*) as n, ${numericSum(store.dialect)} as vol
     FROM trades WHERE token=? AND ts>=?`,
    token,
    since,
  );
  const last = await store.get<{ price_quote_x18: string }>(
    `SELECT price_quote_x18 FROM trades WHERE token=? AND ts>=? AND price_quote_x18 IS NOT NULL AND price_quote_x18 != '0'
     ORDER BY ts DESC, id DESC LIMIT 1`,
    token,
    since,
  );
  const prior = await store.get<{ price_quote_x18: string }>(
    `SELECT price_quote_x18 FROM trades WHERE token=? AND ts<=? AND price_quote_x18 IS NOT NULL AND price_quote_x18 != '0'
     ORDER BY ts DESC, id DESC LIMIT 1`,
    token,
    since,
  );
  const mkt = await store.get<{ price_quote_x18: string; quote: string; stage: string; market_live: number; real_quote: string }>(
    "SELECT price_quote_x18, quote, stage, market_live, real_quote FROM markets WHERE token=?",
    token,
  );
  const grad = await store.get<{ quote_lp: string }>("SELECT quote_lp FROM graduations WHERE token=?", token);
  const tok = await store.get<{ supply: string; decimals: number }>(
    "SELECT supply, decimals FROM tokens WHERE address=?",
    token,
  );
  const qdec = await store.get<{ decimals: number }>("SELECT decimals FROM quote_assets WHERE token=?", mkt?.quote ?? "");
  const price = last?.price_quote_x18 && last.price_quote_x18 !== "0"
    ? last.price_quote_x18
    : mkt?.price_quote_x18 && mkt.price_quote_x18 !== "0"
      ? mkt.price_quote_x18
      : "0";
  let fdv = "0";
  let priceUsd6 = "0";
  let volUsd6 = "0";
  let liquidityUsd6 = "0";
  let chg = "";
  try {
    const svc = await loadValuationService(store);
    const quote = mkt?.quote ?? "";
    const tokenUsd = svc.tokenUsd6(BigInt(price || "0"), quote);
    if (tokenUsd.ok) priceUsd6 = tokenUsd.usd6.toString();
    const quoteUsd = svc.quoteUsd6(quote);
    const dec = Number(qdec?.decimals ?? 6);
    if (quoteUsd.ok) {
      const vol = BigInt(String(agg?.vol ?? "0").split(".")[0] ?? "0");
      volUsd6 = ((vol * quoteUsd.usd6) / 10n ** BigInt(dec)).toString();
    }
    // Read-only: writers are applyTokenLevelBurn / applyOnchainTotalSupply only.
    const remaining = await currentSupplyRaw(store, token);
    const tokenDecimals = Number(tok?.decimals ?? 18);
    const quoteUsd6 = quoteUsd.ok ? quoteUsd.usd6 : 0n;
    fdv = remaining > 0n && quoteUsd6 > 0n
      ? fdvUsd6(BigInt(price || "0"), remaining, tokenDecimals, quoteUsd6).toString()
      : "0";
    const live = Boolean(mkt?.market_live) || mkt?.stage === "v4";
    const quoteRaw = live && grad?.quote_lp && grad.quote_lp !== "0"
      ? BigInt(grad.quote_lp)
      : BigInt(String(mkt?.real_quote || "0"));
    liquidityUsd6 = quoteLiquidityUsd6(quoteRaw, quoteUsd6, dec);
    if (prior?.price_quote_x18 && prior.price_quote_x18 !== "0" && price && price !== "0") {
      chg = change24hBps(BigInt(price), BigInt(prior.price_quote_x18));
    }
  } catch {
    fdv = "0";
  }
  await store.run(
    `UPDATE markets SET volume_24h_quote=?, volume_24h_usd6=?, trades_24h=?, fdv_usd6=?, price_usd6=?, price_quote_x18=?, liquidity_usd6=?, change_24h_bps=?, updated_ts=? WHERE token=?`,
    String(agg?.vol ?? "0"),
    volUsd6,
    Number(agg?.n ?? 0),
    fdv,
    priceUsd6,
    price,
    liquidityUsd6,
    chg,
    nowTs,
    token,
  );
}

export async function applyIncrementalTrade(
  store: Store,
  token: string,
  notionalQuote: string,
  notionalUsd6: string,
  ts: number,
) {
  await store.run(
    `UPDATE markets SET
      volume_24h_quote = CAST(CAST(COALESCE(volume_24h_quote,'0') AS NUMERIC) + CAST(? AS NUMERIC) AS TEXT),
      volume_24h_usd6 = CAST(CAST(COALESCE(volume_24h_usd6,'0') AS NUMERIC) + CAST(? AS NUMERIC) AS TEXT),
      trades_24h = COALESCE(trades_24h,0) + 1,
      updated_ts = ?
     WHERE token=?`,
    notionalQuote,
    notionalUsd6,
    ts,
    token,
  );
  await store.run("UPDATE trades SET rolled=1 WHERE token=? AND ts=? AND COALESCE(rolled,0)=0", token, ts);
}

export async function expireOldWindow(store: Store, token: string, nowTs: number) {
  const since = nowTs - 86_400;
  const old = await store.all<{ notional_quote: string; notional_usd6: string }>(
    "SELECT notional_quote, COALESCE(notional_usd6,'0') as notional_usd6 FROM trades WHERE token=? AND ts<? AND rolled=1",
    token,
    since,
  );
  if (!old.length) return;
  let q = 0n;
  let u = 0n;
  for (const r of old) {
    q += BigInt(String(r.notional_quote || "0").split(".")[0] ?? "0");
    u += BigInt(String(r.notional_usd6 || "0").split(".")[0] ?? "0");
  }
  await store.run(
    `UPDATE markets SET
      volume_24h_quote = CAST(MAX(0, CAST(COALESCE(volume_24h_quote,'0') AS NUMERIC) - CAST(? AS NUMERIC)) AS TEXT),
      volume_24h_usd6 = CAST(MAX(0, CAST(COALESCE(volume_24h_usd6,'0') AS NUMERIC) - CAST(? AS NUMERIC)) AS TEXT),
      trades_24h = MAX(0, COALESCE(trades_24h,0) - ?)
     WHERE token=?`,
    q.toString(),
    u.toString(),
    old.length,
    token,
  );
  await store.run("UPDATE trades SET rolled=2 WHERE token=? AND ts<? AND rolled=1", token, since);
}

export async function rollMarketAggregations(store: Store) {
  const now = Math.floor(Date.now() / 1000);
  const tokens = await store.all<{ token: string }>("SELECT token FROM markets");
  for (const t of tokens) await rollOneMarket(store, t.token, now);
}

export async function setState(store: Store, k: string, v: string) {
  await store.run("INSERT INTO indexer_state(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, v);
}

export async function getState(store: Store, k: string): Promise<string | undefined> {
  const row = await store.get<{ v: string }>("SELECT v FROM indexer_state WHERE k=?", k);
  return row?.v;
}
