/** Offchain Top-10 ranker. Mirrors contracts/src/libraries/Top10Ranker.sol. Never guesses a mark. */

export const TOP10_FLOOR_USDC = 250_000n * 1_000_000n;

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
