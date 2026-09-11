/** Offchain Top-10 ranker. Mirrors contracts/src/libraries/Top10Ranker.sol. Never guesses a mark. */

export const TOP10_FLOOR_USDC = 250_000n * 1_000_000n; // $250k in USDC-6

export type RankCandidate = {
  token: string;
  symbol?: string;
  quote?: string;
  graduated: boolean;
  isCore: boolean;
  markUsdc: bigint;
  markOk: boolean;
};

export type RankRow = {
  rank: number;
  token: string;
  symbol: string;
  quote: string;
  markUsdc: string;
  weightBps: number;
};

export function rankTop10(cands: RankCandidate[], floorUsdc: bigint = TOP10_FLOOR_USDC): {
  rows: RankRow[];
  pauseEpoch: boolean;
  pauseReason?: string;
} {
  type Qual = RankCandidate & { mark: bigint };
  const qual: Qual[] = [];
  for (const c of cands) {
    if (c.isCore || !c.graduated) continue;
    // Material graduated candidate without a defensible mark → fail closed. Never guess.
    if (!c.markOk) {
      return { rows: [], pauseEpoch: true, pauseReason: "material candidate unvalued — pause epoch, never guess" };
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
