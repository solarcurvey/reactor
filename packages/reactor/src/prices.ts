/**
 * Canonical market price: `price_quote_x18` = quote units (18-dec) per 1 whole token.
 * Same unit on InstantCurve and official v4 so OHLCV is continuous across graduation.
 *
 * quote_raw / 10^quoteDecimals  per  token_raw / 10^tokenDecimals
 * → (quote_raw * 10^tokenDecimals * 1e18) / (token_raw * 10^quoteDecimals)
 */

export const X18 = 10n ** 18n;
export const Q192 = 1n << 192n;

export const CANDLE_INTERVALS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
} as const;

export type CandleInterval = keyof typeof CANDLE_INTERVALS;

export type Ohlcv = {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
};

export function priceQuoteX18(quoteRaw: bigint, tokenRaw: bigint, quoteDecimals: number, tokenDecimals: number): bigint {
  if (quoteRaw <= 0n || tokenRaw <= 0n) return 0n;
  return (quoteRaw * 10n ** BigInt(tokenDecimals) * X18) / (tokenRaw * 10n ** BigInt(quoteDecimals));
}

/** Uniswap v4 sqrtPriceX96 → price_quote_x18 (quote per 1 whole token). */
export function priceQuoteX18FromSqrt(
  sqrtPriceX96: bigint,
  tokenIsCurrency0: boolean,
  tokenDecimals: number,
  quoteDecimals: number,
): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const oneToken = 10n ** BigInt(tokenDecimals);
  const quoteRaw = tokenIsCurrency0
    ? (oneToken * sqrtPriceX96 * sqrtPriceX96) / Q192
    : (oneToken * Q192) / (sqrtPriceX96 * sqrtPriceX96);
  return priceQuoteX18(quoteRaw, oneToken, quoteDecimals, tokenDecimals);
}

export function fdvQuoteRawFromPrice(priceQuoteX18: bigint, supplyRaw: bigint, tokenDecimals: number, quoteDecimals: number): bigint {
  if (priceQuoteX18 === 0n || supplyRaw === 0n) return 0n;
  return (priceQuoteX18 * supplyRaw * 10n ** BigInt(quoteDecimals)) / (X18 * 10n ** BigInt(tokenDecimals));
}

export function usd6FromPriceQuote(priceQuoteX18: bigint, quoteUsd6: bigint): bigint {
  if (priceQuoteX18 === 0n || quoteUsd6 === 0n) return 0n;
  return (priceQuoteX18 * quoteUsd6) / X18;
}

export function fdvUsd6(priceQuoteX18: bigint, supplyRaw: bigint, tokenDecimals: number, quoteUsd6: bigint): bigint {
  if (priceQuoteX18 === 0n || supplyRaw === 0n || quoteUsd6 === 0n) return 0n;
  const one = 10n ** BigInt(tokenDecimals);
  return (priceQuoteX18 * supplyRaw * quoteUsd6) / (X18 * one);
}

export function bucketTs(ts: number, intervalSec: number): number {
  return Math.floor(ts / intervalSec) * intervalSec;
}

export function applyTradeToCandle(prev: Ohlcv | undefined, ts: number, intervalSec: number, priceX18: string, notional: string): Ohlcv {
  const t = bucketTs(ts, intervalSec);
  const px = priceX18 && priceX18 !== "0" ? priceX18 : "0";
  if (!prev || prev.t !== t) {
    return { t, o: px, h: px, l: px, c: px, v: notional || "0", n: 1 };
  }
  const next: Ohlcv = { ...prev, c: px, n: prev.n + 1 };
  try {
    if (BigInt(px || "0") > BigInt(prev.h || "0")) next.h = px;
    if (prev.l === "0" || BigInt(px || "0") < BigInt(prev.l || "0")) next.l = px;
    next.v = (BigInt(prev.v || "0") + BigInt(notional || "0")).toString();
  } catch {
    next.v = prev.v;
  }
  return next;
}

/** Fill missing buckets with last close so charts stay continuous across curve→v4. */
export function fillContinuous(candles: Ohlcv[], intervalSec: number, fromTs: number, toTs: number): Ohlcv[] {
  if (candles.length === 0) return [];
  const byT = new Map(candles.map((c) => [c.t, c]));
  const start = bucketTs(fromTs, intervalSec);
  const end = bucketTs(toTs, intervalSec);
  const out: Ohlcv[] = [];
  let last = candles[0]!;
  for (let t = start; t <= end; t += intervalSec) {
    const hit = byT.get(t);
    if (hit) {
      last = hit;
      out.push(hit);
    } else {
      out.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: "0", n: 0 });
    }
  }
  return out;
}
