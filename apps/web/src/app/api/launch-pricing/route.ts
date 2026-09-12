import { NextResponse } from "next/server";
import { BodyTooLargeError, readLimitedText } from "../../../lib/limited-json";

/**
 * Public Next route never talks to the isolated signer.
 * Forwards to indexer POST /launch/authorize (admission → receipt → internal sign).
 * Body is capped (16KiB) before the proxy buffer so chunked oversize cannot fill the BFF.
 */
export async function POST(req: Request) {
  const indexer = process.env.INDEXER_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:43148";
  try {
    const body = await readLimitedText(req);
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
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return NextResponse.json({ error: e.message }, { status: 413 });
    }
    return NextResponse.json(
      { error: "launch authorization unavailable — admission/signer down", needsAuth: true },
      { status: 503 },
    );
  }
}
