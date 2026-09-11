import { NextResponse } from "next/server";
import { rankTop10, type RankCandidate } from "@/lib/top10";

export const dynamic = "force-dynamic";

/**
 * REACTOR API Top-10. Offchain ranks + weights. Contracts do not verify market caps.
 * Nested quote USD must be resolved here. If a mark is unreliable: skip / pause — never guess.
 */
export async function GET() {
  const raw = process.env.REACTOR_TOP10_CANDIDATES;
  let cands: RankCandidate[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Array<RankCandidate & { markUsdc: string | number }>;
      cands = parsed.map((c) => ({
        ...c,
        markUsdc: BigInt(c.markUsdc),
      }));
    } catch {
      return NextResponse.json({
        source: "api",
        pauseEpoch: true,
        reason: "candidate payload unreadable — epoch paused, no guess",
        rows: [],
        trust: "offchain ranks; Keeper submits; contract checks structure only",
      });
    }
  }

  const { rows, pauseEpoch } = rankTop10(cands);
  return NextResponse.json({
    source: "api",
    pauseEpoch,
    reason: pauseEpoch
      ? "unreliable mark — skip token / pause epoch, never guess"
      : rows.length === 0
        ? "no graduated names with a defensible mark ≥ $250k"
        : "operational ranks from REACTOR API (~5 min)",
    rows,
    floorUsdc: "250000000000",
    trust: "Not a trustless oracle. API computes ranks; designated Keeper publishes epoch; onchain verifies structure only.",
  });
}
