import { NextResponse } from "next/server";
import { indexerBaseUrl } from "@/lib/operator-policy-status";

export const dynamic = "force-dynamic";

/** Public #62 challenge proxy. Not a write. Does not accept a claimed wallet. */
export async function GET(req: Request) {
  const indexer = indexerBaseUrl();
  try {
    const res = await fetch(`${indexer}/operator-policy/challenge`, {
      signal: AbortSignal.timeout(6_000),
      headers: {
        "x-request-id": req.headers.get("x-request-id") ?? "",
      },
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "wallet proof challenge unavailable" }, { status: 503 });
  }
}
