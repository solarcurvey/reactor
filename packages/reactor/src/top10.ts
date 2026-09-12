/** Offchain Top-10 ranker. Mirrors contracts/src/libraries/Top10Ranker.sol. Never guesses a mark. */

import { Q192 } from "./prices.ts";

export const TOP10_FLOOR_USDC = 250_000n * 1_000_000n;
/** 12 minutes — middle of the frozen 10–15m VWAP/TWAP window. */
export const MARK_WINDOW_SEC = 12 * 60;
export const MIN_VWAP_SAMPLES = 3;
/**
 * Bounded age for a persisted GET /top10 snapshot.
 * Shared by indexer serve and Keeper accept. A stalled ranker must not keep
 * a healthy payload live after this TTL.
 */
export const TOP10_SNAPSHOT_TTL_SEC = 15 * 60;

export type PriceSample = { notional: bigint; priceQuoteX18: bigint; ts: number };
export type TradeSample = { notional: bigint; sqrtPrice: bigint; ts: number };

/** FDV in quote raw units from official sqrtPrice and circulating/total supply. */
export function fdvQuoteRaw(sqrt: bigint, supply: bigint, tokenIs0: boolean): bigint {
  if (sqrt === 0n || supply === 0n) return 0n;
  return tokenIs0 ? (supply * sqrt * sqrt) / Q192 : (supply * Q192) / (sqrt * sqrt);
}

/** Volume-weighted price_quote_x18. Fail closed on a thin 10–15m window. */
export function vwapPriceQuoteX18(
  samples: PriceSample[],
  nowSec: number,
  windowSec = MARK_WINDOW_SEC,
): { priceX18: bigint; ok: boolean; n: number } {
  const from = nowSec - windowSec;
  const inWin = samples.filter((s) => s.ts >= from && s.priceQuoteX18 > 0n && s.notional > 0n);
  if (inWin.length < MIN_VWAP_SAMPLES) return { priceX18: 0n, ok: false, n: inWin.length };
  let num = 0n;
  let den = 0n;
  for (const s of inWin) {
    num += s.priceQuoteX18 * s.notional;
    den += s.notional;
  }
  if (den === 0n) return { priceX18: 0n, ok: false, n: inWin.length };
  return { priceX18: num / den, ok: true, n: inWin.length };
}

/** Historical VWAP ending at the last pre-window trade. */
export function lastGoodPriceQuoteX18(
  samples: PriceSample[],
  nowSec: number,
  windowSec = MARK_WINDOW_SEC,
): bigint {
  const older = samples.filter((s) => s.ts < nowSec - windowSec && s.priceQuoteX18 > 0n && s.notional > 0n);
  if (older.length < MIN_VWAP_SAMPLES) return 0n;
  const end = older[older.length - 1]!.ts;
  const v = vwapPriceQuoteX18(older, end, windowSec);
  return v.ok ? v.priceX18 : 0n;
}

/** Volume-weighted FDV in quote raw from indexed trades. Fail closed on thin windows. */
export function vwapFdvQuoteRaw(
  samples: TradeSample[],
  supply: bigint,
  tokenIs0: boolean,
  nowSec: number,
  windowSec = MARK_WINDOW_SEC,
): { fdv: bigint; ok: boolean } {
  const from = nowSec - windowSec;
  const inWin = samples.filter((s) => s.ts >= from && s.sqrtPrice > 0n && s.notional > 0n);
  if (inWin.length < MIN_VWAP_SAMPLES || supply === 0n) return { fdv: 0n, ok: false };
  let num = 0n;
  let den = 0n;
  for (const s of inWin) {
    const fdv = fdvQuoteRaw(s.sqrtPrice, supply, tokenIs0);
    if (fdv === 0n) continue;
    num += fdv * s.notional;
    den += s.notional;
  }
  if (den === 0n) return { fdv: 0n, ok: false };
  return { fdv: num / den, ok: true };
}

/** Historical VWAP ending at the last pre-window trade. `nowSec = last.ts` so 3 samples in 12m can qualify. */
export function lastGoodFdvQuote(samples: TradeSample[], supply: bigint, tokenIs0: boolean, nowSec: number): bigint {
  const older = samples.filter((s) => s.ts < nowSec - MARK_WINDOW_SEC && s.sqrtPrice > 0n && s.notional > 0n);
  if (older.length < MIN_VWAP_SAMPLES) return 0n;
  const end = older[older.length - 1]!.ts;
  const v = vwapFdvQuoteRaw(older, supply, tokenIs0, end);
  return v.ok ? v.fdv : 0n;
}

export function isCoreToken(token: string, coreAddresses: readonly string[]): boolean {
  const t = token.toLowerCase();
  return coreAddresses.some((a) => a && a.toLowerCase() === t);
}

export type Top10SnapshotClock = {
  computedTs?: number | string | null;
  pauseEpoch?: boolean;
  reason?: string;
};

/** Age in seconds. Missing / non-positive computedTs is treated as infinitely old. */
export function snapshotAgeSec(computedTs: number | string | null | undefined, nowSec: number): number {
  const ts = Number(computedTs ?? 0);
  if (!Number.isFinite(ts) || ts <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowSec - ts);
}

export function isSnapshotFresh(
  computedTs: number | string | null | undefined,
  nowSec: number,
  ttlSec = TOP10_SNAPSHOT_TTL_SEC,
): boolean {
  return snapshotAgeSec(computedTs, nowSec) <= ttlSec;
}

export function staleSnapshotReason(ageSec: number, ttlSec = TOP10_SNAPSHOT_TTL_SEC): string {
  const age = Number.isFinite(ageSec) ? Math.floor(ageSec) : "unknown";
  return `snapshot age ${age}s exceeds TTL ${ttlSec}s — pause epoch, never serve stale ranks`;
}

/** Keeper + API share this gate. pauseEpoch or age past TTL refuses submit. */
export function acceptTop10Snapshot(
  body: Top10SnapshotClock,
  nowSec: number,
  ttlSec = TOP10_SNAPSHOT_TTL_SEC,
): { ok: boolean; reason: string } {
  if (body.pauseEpoch) return { ok: false, reason: body.reason ?? "epoch paused" };
  if (!isSnapshotFresh(body.computedTs, nowSec, ttlSec)) {
    return { ok: false, reason: staleSnapshotReason(snapshotAgeSec(body.computedTs, nowSec), ttlSec) };
  }
  return { ok: true, reason: "" };
}

export type RankCandidate = {
  token: string;
  symbol?: string;
  quote?: string;
  graduated: boolean;
  isCore: boolean;
  markUsdc: bigint;
  markOk: boolean;
  lastGoodMarkUsdc?: bigint;
  liquidityUsdc?: bigint;
  windowVolumeUsdc?: bigint;
  tradeCount?: number;
  priorRanked?: boolean;
};

export type RankRow = {
  rank: number;
  token: string;
  symbol: string;
  quote: string;
  markUsdc: string;
  weightBps: number;
};

/** Could this name plausibly change the Top-10 if we guessed a mark? */
export function materialUncertainty(c: RankCandidate, floorUsdc: bigint = TOP10_FLOOR_USDC): boolean {
  if (c.priorRanked) return true;
  if ((c.lastGoodMarkUsdc ?? 0n) >= floorUsdc) return true;
  if ((c.liquidityUsdc ?? 0n) >= floorUsdc / 5n) return true;
  if ((c.windowVolumeUsdc ?? 0n) >= floorUsdc / 10n && (c.lastGoodMarkUsdc ?? 0n) >= floorUsdc / 2n) return true;
  return false;
}

export function rankTop10(cands: RankCandidate[], floorUsdc: bigint = TOP10_FLOOR_USDC): {
  rows: RankRow[];
  pauseEpoch: boolean;
  pauseReason?: string;
} {
  type Qual = RankCandidate & { mark: bigint };
  const qual: Qual[] = [];
  for (const c of cands) {
    if (c.isCore || !c.graduated) continue;
    if (!c.markOk) {
      if (materialUncertainty(c, floorUsdc)) {
        return {
          rows: [],
          pauseEpoch: true,
          pauseReason: "material candidate unvalued — pause epoch, never guess",
        };
      }
      continue;
    }
    if (c.markUsdc < floorUsdc) continue;
    qual.push({ ...c, mark: c.markUsdc });
  }
  qual.sort((a, b) => (a.mark === b.mark ? 0 : a.mark > b.mark ? -1 : 1));
  const filled = qual.slice(0, 10);
  if (filled.length === 0) return { rows: [], pauseEpoch: false };
  const sum = filled.reduce((s, x) => s + x.mark, 0n);
  let acc = 0;
  const rows: RankRow[] = filled.map((c, i) => {
    let w: number;
    if (i === filled.length - 1) {
      w = 10_000 - acc;
    } else {
      w = Number((c.mark * 10_000n) / sum);
      acc += w;
    }
    return {
      rank: i + 1,
      token: c.token,
      symbol: c.symbol ?? c.token.slice(0, 6),
      quote: c.quote ?? "",
      markUsdc: c.mark.toString(),
      weightBps: w,
    };
  });
  return { rows, pauseEpoch: false };
}
