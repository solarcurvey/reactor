import type { Store } from "./db.ts";
import type { SseHub } from "./sse.ts";
import { applyTradeToCandle, CANDLE_INTERVALS, priceQuoteX18 } from "../../../packages/reactor/src/prices.ts";

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
  sse: SseHub | undefined,
  t: {
    block: number;
    tx: string;
    logIndex?: number;
    chainId?: number;
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
  try {
    await store.run(
      `INSERT INTO trades(chain_id,block,tx,log_index,token,quote,side,source,amount_in,amount_out,notional_quote,price_quote_x18,sqrt_price,holders_fee,flywheel_fee,core_fee,ts)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
  } catch {
    return;
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

async function rollOneMarket(store: Store, token: string, nowTs: number) {
  const since = nowTs - 86_400;
  const agg = await store.get<{ n: number; vol: string; last: string }>(
    `SELECT COUNT(*) as n, COALESCE(SUM(CAST(notional_quote AS INTEGER)),0) as vol,
            MAX(price_quote_x18) as last
     FROM trades WHERE token=? AND ts>=?`,
    token,
    since,
  );
  const mkt = await store.get<{ price_quote_x18: string; quote: string }>(
    "SELECT price_quote_x18, quote FROM markets WHERE token=?",
    token,
  );
  const tok = await store.get<{ supply: string }>("SELECT supply FROM tokens WHERE address=?", token);
  const price = mkt?.price_quote_x18 && mkt.price_quote_x18 !== "0" ? mkt.price_quote_x18 : agg?.last ?? "0";
  let fdv = "0";
  try {
    const supply = BigInt(tok?.supply || "0");
    const px = BigInt(price || "0");
    fdv = supply > 0n && px > 0n ? ((supply * px) / 10n ** 18n).toString() : "0";
  } catch {
    fdv = "0";
  }
  await store.run(
    `UPDATE markets SET volume_24h_quote=?, trades_24h=?, fdv_usd6=?, price_usd6=?, updated_ts=? WHERE token=?`,
    String(agg?.vol ?? "0"),
    Number(agg?.n ?? 0),
    fdv,
    price,
    nowTs,
    token,
  );
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
