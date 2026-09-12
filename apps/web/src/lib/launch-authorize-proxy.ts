/**
 * Public Next BFF for launch authorization (issue #62).
 * Forwards to indexer POST /launch/authorize. The indexer gate is authoritative.
 * Client-supplied clear/country flags are never treated as a decision here.
 */
import { BodyTooLargeError, readLimitedText } from "./limited-json";

const UNTRUSTED_FORWARD = new Set([
  "x-sanctions-clear",
  "x-sanctions-decision",
  "x-ofac-clear",
  "x-ofac-status",
  "x-compliance-ok",
  "cf-ipcountry",
  "x-country",
  "x-country-code",
  "x-geo-country",
  "x-forwarded-for",
  "x-real-ip",
  "true-client-ip",
  "cloudfront-viewer-country",
]);

const TRUSTED_FORWARD = [
  "x-request-id",
  "x-reactor-wallet-proof",
  "x-reactor-geo-fixture",
  "x-reactor-geo",
  "x-reactor-geo-ts",
  "x-reactor-geo-country",
  "x-reactor-geo-region",
  "x-reactor-geo-region-name",
  "x-reactor-geo-anonymizer",
  "x-reactor-geo-ip",
  "x-reactor-geo-mac",
];

const UNTRUSTED_IDENTITY = ["x-reactor-wallet"];

export function indexerLaunchAuthorizeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const indexer = env.INDEXER_URL ?? env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:43148";
  return `${indexer.replace(/\/$/, "")}/launch/authorize`;
}

export function launchAuthorizeForwardHeaders(req: Request, bodyText: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const name of TRUSTED_FORWARD) {
    const v = req.headers.get(name);
    if (v) headers[name] = v;
  }
  for (const name of UNTRUSTED_FORWARD) {
    delete headers[name];
  }
  for (const name of UNTRUSTED_IDENTITY) {
    delete headers[name];
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
