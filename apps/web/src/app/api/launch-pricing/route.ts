import { NextResponse } from "next/server";

/**
 * Public Next route never talks to the isolated signer.
 * Forwards to indexer POST /launch/authorize (admission → receipt → internal sign).
 */
export async function POST(req: Request) {
  const indexer = process.env.INDEXER_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:43148";
  try {
    const body = await req.text();
    const res = await fetch(`${indexer.replace(/\/$/, "")}/launch/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": req.headers.get("x-request-id") ?? "",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "launch authorization unavailable — admission/signer down", needsAuth: true },
      { status: 503 },
    );
  }
}
