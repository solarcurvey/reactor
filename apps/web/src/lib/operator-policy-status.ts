/**
 * Next BFF resolver for GET /api/operator-policy (issue #65).
 *
 * Prefers indexer `GET /operator-policy/status` from #62 / PR #68 when present.
 * Until that path exists, LOCAL stubs allow (demo continues) and production-like
 * environments fail closed as temporarily unavailable.
 *
 * Browser-supplied clear/country/IP/wallet flags never become authority.
 */
import {
  allowStubView,
  isOperatorPolicyReason,
  publicPolicyView,
  sanitizePublicPolicyView,
  unavailableStubView,
  type OperatorPolicyReason,
  type PublicOperatorPolicyView,
} from "./operator-policy";

export const OPERATOR_POLICY_STATUS_PATH = "/operator-policy/status";

/** Headers the BFF may forward to the indexer. Nothing else. */
export const FORWARDED_POLICY_HEADERS = ["x-reactor-wallet-proof", "x-request-id"] as const;

export const IGNORED_CLIENT_AUTHORITY = [
  "x-sanctions-clear",
  "x-ofac-clear",
  "x-reactor-wallet",
  "cf-ipcountry",
  "x-country",
  "x-forwarded-for",
  "x-real-ip",
  "true-client-ip",
] as const;

export function productionLike(env: NodeJS.ProcessEnv = process.env): boolean {
  const reactor = (env.REACTOR_ENV ?? "").toUpperCase();
  if (reactor === "LOCAL") return false;
  if (reactor === "PROD" || reactor === "PRODUCTION" || reactor === "STAGING" || reactor === "TESTNET") return true;
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") return true;
  return false;
}

export function indexerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.INDEXER_URL ?? env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:43148").replace(/\/$/, "");
}

function header(headers: Headers, name: string): string {
  return (headers.get(name) ?? "").trim();
}

function localFixtureReason(req: Request, env: NodeJS.ProcessEnv): OperatorPolicyReason | undefined {
  if (productionLike(env)) return undefined;
  const fromEnv = (env.OPERATOR_POLICY_UX_FIXTURE ?? "").trim();
  if (isOperatorPolicyReason(fromEnv) && fromEnv !== "ALLOW") return fromEnv;
  const url = new URL(req.url);
  const fromQuery = (url.searchParams.get("fixture") ?? "").trim();
  if (isOperatorPolicyReason(fromQuery)) return fromQuery;
  const fromHeader = header(req.headers, "x-reactor-ux-fixture");
  if (isOperatorPolicyReason(fromHeader)) return fromHeader;
  return undefined;
}

export function pickForwardHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const name of FORWARDED_POLICY_HEADERS) {
    const value = incoming.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

export async function fetchIndexerPolicyStatus(input: {
  indexer: string;
  headers: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PublicOperatorPolicyView | { missing: true } | { failed: true }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${input.indexer}${OPERATOR_POLICY_STATUS_PATH}`, {
      method: "GET",
      headers: input.headers,
      signal: AbortSignal.timeout(input.timeoutMs ?? 4_000),
    });
    if (res.status === 404) return { missing: true };
    const json: unknown = await res.json().catch(() => null);
    const view = sanitizePublicPolicyView(json, "indexer");
    if (view) return view;
    if (!res.ok) return { failed: true };
    return { failed: true };
  } catch {
    return { missing: true };
  }
}

export async function resolveOperatorPolicyStatus(input: {
  req: Request;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<PublicOperatorPolicyView> {
  const env = input.env ?? process.env;
  const fixture = localFixtureReason(input.req, env);
  if (fixture) {
    return publicPolicyView({ reason: fixture, source: "fixture" });
  }

  const forwarded = pickForwardHeaders(input.req.headers);
  const fromIndexer = await fetchIndexerPolicyStatus({
    indexer: indexerBaseUrl(env),
    headers: forwarded,
    fetchImpl: input.fetchImpl,
  });
  if ("ok" in fromIndexer) return fromIndexer;
  if ("failed" in fromIndexer) return unavailableStubView();
  return productionLike(env) ? unavailableStubView() : allowStubView();
}
