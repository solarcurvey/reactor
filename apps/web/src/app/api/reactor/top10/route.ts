import { NextResponse } from "next/server";
import { INDEXER_URL } from "@/lib/chain";
import { reportFailure } from "@/lib/obs/telemetry";

export const dynamic = "force-dynamic";

/**
 * Public Top-10 proxy. Official ranks live on the indexer (ValuationService +
 * persisted markets). This route does not enumerate Factory tokens or value
 * markets. Keeper and this page read the same `/top10` snapshot.
 */
export async function GET() {
  try {
    const base = (process.env.INDEXER_URL ?? INDEXER_URL).replace(/\/$/, "");
    const res = await fetch(`${base}/top10`, { cache: "no-store" });
    if (!res.ok) {
      reportFailure("api", new Error(`GET /top10 ${res.status}`), { path: "/top10", status: res.status });
    }
    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(body, { status: 200 });
  } catch (e) {
    reportFailure("api", e, { path: "/api/reactor/top10" });
    return NextResponse.json(
      {
        source: "valuation-service",
        pauseEpoch: true,
        reason: e instanceof Error ? e.message : "indexer top10 unreachable — epoch paused, no guess",
        rows: [],
        candidates: 0,
        floorUsdc: "250000000000",
        trust: "Fail closed. Keeper must skip this epoch.",
      },
      { status: 200 },
    );
  }
}
