/**
 * Public Next BFF for launch authorization (issue #62).
 * Forwards to indexer POST /launch/authorize. The indexer gate is authoritative.
 * Only the recovered-wallet proof and request id hop through. Browser country /
 * claimed-wallet / “clear” flags are dropped — trusted geo HMAC is an indexer-edge
 * concern (#67), not a Next replay.
 */
import { BodyTooLargeError, readLimitedText } from "./limited-json";

const FORWARD = ["x-request-id", "x-reactor-wallet-proof"] as const;

export function indexerLaunchAuthorizeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const indexer = env.INDEXER_URL ?? env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:43148";
  return `${indexer.replace(/\/$/, "")}/launch/authorize`;
}

export function launchAuthorizeForwardHeaders(req: Request, bodyText: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const name of FORWARD) {
    const v = req.headers.get(name);
    if (v) headers[name] = v;
  }
  void bodyText;
  return headers;
}

export async function proxyLaunchAuthorize(req: Request, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  try {
    const body = await readLimitedText(req);
    const res = await fetch(indexerLaunchAuthorizeUrl(env), {
      method: "POST",
      headers: launchAuthorizeForwardHeaders(req, body),
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    return Response.json(json, { status: res.status });
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return Response.json({ error: e.message }, { status: 413 });
    }
    return Response.json(
      { error: "launch authorization unavailable — admission/signer down", needsAuth: true },
      { status: 503 },
    );
  }
}
