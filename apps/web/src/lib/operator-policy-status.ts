/**
 * Next BFF resolver for GET /api/operator-policy (issue #65).
 *
 * Calls the real #62 / PR #68 indexer endpoint: `GET /operator-policy/challenge`.
 * Draft #68 is not on `main` and does not expose a public decision GET — do not
 * invent a parallel `/operator-policy/status`. Write gates remain authoritative.
 *
 * Subject is the EIP-191 signer of that challenge. Claimed `x-reactor-wallet` /
 * body.wallet is never forwarded or trusted.
 *
 * LOCAL UX fixtures demo deny/unavailable. Production-like fail-closes when the
 * challenge path is missing or when #68 has not published a public decision body.
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

/** Official #62 / #68 public operator-policy path. Not a decision GET. */
export const OPERATOR_POLICY_CHALLENGE_PATH = "/operator-policy/challenge";

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

export function pickForwardHeaders(incoming: Headers, env: NodeJS.ProcessEnv = process.env): Headers {
  const out = new Headers();
  for (const name of FORWARDED_POLICY_HEADERS) {
    const value = incoming.get(name);
    if (value) out.set(name, value);
  }
  if (!productionLike(env)) {
    const geo = incoming.get("x-reactor-geo-fixture");
    if (geo) out.set("x-reactor-geo-fixture", geo);
  }
  return out;
}

function isChallengeBody(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const rec = json as Record<string, unknown>;
  return typeof rec.token === "string" && typeof rec.message === "string";
}

/**
 * Probe the official #62/#68 challenge path. A challenge body means the gate is
 * present; a sanitized public decision is only used if #68 later returns one
 * (forward-compat). A mismatched `/status` path is never called.
 */
export async function fetchIndexerPolicyStatus(input: {
  indexer: string;
  headers: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PublicOperatorPolicyView | { missing: true } | { failed: true } | { present: true }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${input.indexer}${OPERATOR_POLICY_CHALLENGE_PATH}`, {
      method: "GET",
      headers: input.headers,
      signal: AbortSignal.timeout(input.timeoutMs ?? 4_000),
    });
    if (res.status === 404) return { missing: true };
    const json: unknown = await res.json().catch(() => null);
    const view = sanitizePublicPolicyView(json, "indexer");
    if (view) return view;
    if (!res.ok) return { failed: true };
    if (isChallengeBody(json)) return { present: true };
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

  const forwarded = pickForwardHeaders(input.req.headers, env);
  const fromIndexer = await fetchIndexerPolicyStatus({
    indexer: indexerBaseUrl(env),
    headers: forwarded,
    fetchImpl: input.fetchImpl,
  });
  if ("ok" in fromIndexer) return fromIndexer;
  if ("failed" in fromIndexer) return unavailableStubView();
  // Challenge present (#68 contract) but no public decision GET yet.
  if ("present" in fromIndexer) {
    return productionLike(env) ? unavailableStubView() : allowStubView();
  }
  return productionLike(env) ? unavailableStubView() : allowStubView();
}
