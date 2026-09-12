/**
 * Next BFF resolver for GET /api/operator-policy (issue #65).
 *
 * Decision read: indexer `GET /operator-policy/status` — same
 * `evaluateOperatorPolicy` + recovered-wallet subject as #62 / PR #68 write
 * gates. Stock #68 today only has `GET /operator-policy/challenge`; if status
 * 404s, this BFF probes that official challenge path and LOCAL-allows /
 * production-fail-closes until #68 lists status as a public read.
 *
 * Claimed `x-reactor-wallet` / body.wallet is never forwarded or trusted.
 * Proof is optional on status (geo-only pre-wallet UX). Writes still require
 * a recovered proof at the indexer gate.
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

/** Coordinated #62 UX decision GET (this branch; #68 should adopt). */
export const OPERATOR_POLICY_STATUS_PATH = "/operator-policy/status";

/** Official #62 / #68 public challenge path. Not a decision GET. */
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

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Headers,
  timeoutMs: number,
): Promise<{ status: number; json: unknown } | { network: true }> {
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: unknown = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { network: true };
  }
}

/**
 * Prefer coordinated `GET /operator-policy/status`. If that 404s (stock #68),
 * probe `GET /operator-policy/challenge` so we never treat a missing invented
 * path as the only production signal.
 */
export async function fetchIndexerPolicyStatus(input: {
  indexer: string;
  headers: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PublicOperatorPolicyView | { missing: true } | { failed: true } | { present: true }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 4_000;

  const status = await fetchJson(
    fetchImpl,
    `${input.indexer}${OPERATOR_POLICY_STATUS_PATH}`,
    input.headers,
    timeoutMs,
  );
  if (!("network" in status) && status.status !== 404) {
    const view = sanitizePublicPolicyView(status.json, "indexer");
    if (view) return view;
    if (status.status >= 400) return { failed: true };
  }

  const challenge = await fetchJson(
    fetchImpl,
    `${input.indexer}${OPERATOR_POLICY_CHALLENGE_PATH}`,
    input.headers,
    timeoutMs,
  );
  if ("network" in challenge) return { missing: true };
  if (challenge.status === 404) return { missing: true };
  const view = sanitizePublicPolicyView(challenge.json, "indexer");
  if (view) return view;
  if (!challenge.status || challenge.status >= 400) return { failed: true };
  if (isChallengeBody(challenge.json)) return { present: true };
  return { failed: true };
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
  if ("present" in fromIndexer) {
    return productionLike(env) ? unavailableStubView() : allowStubView();
  }
  return productionLike(env) ? unavailableStubView() : allowStubView();
}
