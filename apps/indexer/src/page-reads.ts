import { CANDLE_INTERVALS, fillCandlesForRequest, type Ohlcv } from "../../../packages/reactor/src/prices.ts";
import type { Store } from "./db.ts";
import { getMarket, normalizeMarketToken } from "./markets-query.ts";

export type CandleQuery = {
  interval?: string | null;
  limit?: number;
  before?: string | null;
  after?: string | null;
};

export type SwapQuery = {
  limit?: number;
  beforeId?: string | null;
};

export async function listCandles(
  store: Store,
  token: string,
  opts: CandleQuery = {},
): Promise<{ interval: string; sec: number; limit: number; before: string | null; after: string | null; candles: Ohlcv[] } | null> {
  const addr = normalizeMarketToken(token);
  if (!addr) return null;
  const interval = (opts.interval ?? "5m") as keyof typeof CANDLE_INTERVALS;
  const sec = CANDLE_INTERVALS[interval] ?? 300;
  const resolved = CANDLE_INTERVALS[interval] != null ? String(interval) : "5m";
  const limit = Math.min(1_000, Math.max(1, Number(opts.limit ?? 300)));
  const before = opts.before ?? null;
  const after = opts.after ?? null;
  const clauses = ["token=?", "interval_sec=?"];
  const params: unknown[] = [addr, sec];
  if (before) {
    clauses.push("t<?");
    params.push(Number(before));
  }
  if (after) {
    clauses.push("t>?");
    params.push(Number(after));
  }
  const rows = await store.all<Ohlcv>(
    `SELECT t,o,h,l,c,v,n FROM candles WHERE ${clauses.join(" AND ")} ORDER BY t DESC LIMIT ?`,
    ...params,
    limit,
  );
  rows.reverse();
  const now = Math.floor(Date.now() / 1000);
  const filled = fillCandlesForRequest(
    rows,
    sec,
    limit,
    now,
    before != null ? Number(before) : null,
    after != null ? Number(after) : null,
  );
  return { interval: resolved, sec, limit, before, after, candles: filled };
}

export async function listSwaps(store: Store, token: string, opts: SwapQuery = {}): Promise<Record<string, unknown>[] | null> {
  const addr = normalizeMarketToken(token);
  if (!addr) return null;
  const limit = Math.min(500, Math.max(1, Number(opts.limit ?? 200)));
  const clauses = ["token=?"];
  const params: unknown[] = [addr];
  if (opts.beforeId) {
    clauses.push("id<?");
    params.push(Number(opts.beforeId));
  }
  const rows = await store.all<Record<string, unknown>>(
    `SELECT id, block as t, ts, notional_quote as notional, holders_fee as holders, flywheel_fee as flywheel, core_fee as coreAmt, tx, sqrt_price as sqrtPrice, amount_out as tokensOut, source, price_quote_x18 as px FROM trades WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`,
    ...params,
    limit,
  );
  rows.reverse();
  return rows;
}

export type TokenPageAggregate = {
  ok: true;
  token: `0x${string}`;
  market: Record<string, unknown>;
  candles: Ohlcv[];
  interval: string;
  sparse: boolean;
  swaps: Record<string, unknown>[];
};

export async function aggregateTokenPage(
  store: Store,
  token: string,
  opts: { interval?: string | null; candleLimit?: number; swapLimit?: number } = {},
): Promise<TokenPageAggregate | { ok: false; reason: string }> {
  const addr = normalizeMarketToken(token);
  if (!addr) return { ok: false, reason: "invalid token" };
  const [market, candleBody, swaps] = await Promise.all([
    getMarket(store, addr),
    listCandles(store, addr, { interval: opts.interval, limit: opts.candleLimit ?? 300 }),
    listSwaps(store, addr, { limit: opts.swapLimit ?? 200 }),
  ]);
  if (!market) return { ok: false, reason: "market not found" };
  const candles = candleBody?.candles ?? [];
  const real = candles.filter((c) => c.n > 0).length;
  return {
    ok: true,
    token: addr,
    market,
    candles,
    interval: candleBody?.interval ?? String(opts.interval ?? "5m"),
    sparse: real === 0 || real < 3,
    swaps: swaps ?? [],
  };
}
