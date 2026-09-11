import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { arcLocal } from "@/lib/chain";
import { discoverTop10 } from "@/lib/marketdata";

export const dynamic = "force-dynamic";

/**
 * REACTOR API Top-10. Discovers graduated tokens on-chain, marks from official
 * prices + recursive quote/USD. Fail closed. Not env JSON. Not a trustless oracle.
 */
export async function GET() {
  try {
    const client = createPublicClient({ chain: arcLocal, transport: http(arcLocal.rpcUrls.default.http[0]) });
    const discovered = await discoverTop10(client);
    return NextResponse.json({
      source: "chain",
      pauseEpoch: discovered.pauseEpoch,
      reason: discovered.reason,
      rows: discovered.rows,
      candidates: discovered.candidates,
      floorUsdc: "250000000000",
      trust:
        "Not a trustless oracle. API discovers graduated markets and official marks; designated Keeper publishes epoch; onchain verifies structure only.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        source: "chain",
        pauseEpoch: true,
        reason: e instanceof Error ? e.message : "discovery failed — epoch paused, no guess",
        rows: [],
        trust: "Fail closed. Keeper must skip this epoch.",
      },
      { status: 200 },
    );
  }
}
