import { NextResponse } from "next/server";

/**
 * Next never holds the pricing key. Proxies to the isolated signer.
 * FAIL if the signer is down. Anvil fallback is forbidden unless REACTOR_ENV=LOCAL
 * on the signer process itself.
 */
export async function POST(req: Request) {
  const url = process.env.PRICING_SIGNER_URL;
  const local = (process.env.REACTOR_ENV ?? "").toUpperCase() === "LOCAL";
  if (!url && !local) {
    return NextResponse.json(
      { error: "pricing signer unavailable — launch disabled", needsAuth: true },
      { status: 503 },
    );
  }
  const target = url ?? "http://127.0.0.1:43149";
  try {
    const body = await req.text();
    const res = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": req.headers.get("x-request-id") ?? "" },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "pricing signer unavailable — launch disabled", needsAuth: true },
      { status: 503 },
    );
  }
}
