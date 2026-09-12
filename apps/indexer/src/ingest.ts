import type { Store } from "./db.ts";
import { applyTradeToCandle, CANDLE_INTERVALS, priceQuoteX18 } from "../../../packages/reactor/src/prices.ts";
import { journalEvent } from "./event-identity.ts";
import { isUniqueViolation } from "./unique.ts";
import { loadValuationService } from "./valuation-store.ts";

export type SsePublisher = { publish(ev: { type: string; data: unknown }): void };

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
    ticker?: string;
    factoryVersion?: number;
    block?: number;
    tx?: string;
    ts?: number;
  },
) {
  await store.run(
    `INSERT INTO tokens(address,symbol,name,decimals,creator,quote,mode,rewards_mode,supply,ticker,factory_version,created_block,created_tx,created_ts)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(address) DO UPDATE SET symbol=COALESCE(excluded.symbol,tokens.symbol), quote=COALESCE(excluded.quote,tokens.quote), ticker=COALESCE(NULLIF(excluded.ticker,''),tokens.ticker)`,
    row.address.toLowerCase(),
    row.symbol ?? "",
    row.name ?? "",
    row.decimals ?? 18,
    row.creator ?? "",
    (row.quote ?? "").toLowerCase(),
    row.mode ?? 0,
    row.rewardsMode === false ? 0 : 1,
    row.supply ?? "",
    row.ticker ?? row.symbol ?? "",
    row.factoryVersion ?? 1,
    row.block ?? 0,
    row.tx ?? "",
    row.ts ?? 0,
  );
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
  if (
    !(await journalEvent(store, {
      chainId,
      tx: t.tx,
      logIndex,
      eventKind,
      address: t.address ?? token,
      block: t.block,
      ts: t.ts,
    }))
  ) {
    return;
  }
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

async function rollOneMarket(store: Store, token: string, nowTs: number) {
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
  const mkt = await store.get<{ price_quote_x18: string; quote: string }>(
    "SELECT price_quote_x18, quote FROM markets WHERE token=?",
    token,
  );
  const tok = await store.get<{ supply: string }>("SELECT supply FROM tokens WHERE address=?", token);
  const qdec = await store.get<{ decimals: number }>("SELECT decimals FROM quote_assets WHERE token=?", mkt?.quote ?? "");
  const price = last?.price_quote_x18 && last.price_quote_x18 !== "0"
    ? last.price_quote_x18
    : mkt?.price_quote_x18 && mkt.price_quote_x18 !== "0"
      ? mkt.price_quote_x18
      : "0";
  let fdv = "0";
  let priceUsd6 = "0";
  let volUsd6 = "0";
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
    const supply = BigInt(tok?.supply || "0");
    const px = BigInt(price || "0");
    fdv = supply > 0n && tokenUsd.ok ? ((supply * tokenUsd.usd6) / 10n ** 18n).toString() : "0";
    void px;
  } catch {
    fdv = "0";
  }
  await store.run(
    `UPDATE markets SET volume_24h_quote=?, volume_24h_usd6=?, trades_24h=?, fdv_usd6=?, price_usd6=?, price_quote_x18=?, updated_ts=? WHERE token=?`,
    String(agg?.vol ?? "0"),
    volUsd6,
    Number(agg?.n ?? 0),
    fdv,
    priceUsd6,
    price,
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
