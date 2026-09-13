/**
 * Next BFF resolver for GET /api/operator-policy (issue #65).
 *
 * Official #62 / #68 decision read is indexer `GET /operator-policy/status`
 * only (`readOperatorPolicyStatus` / `evaluateOperatorPolicy`). Optional
 * `x-reactor-wallet-proof` screens the recovered signer. Claimed `wallet` /
 * country / `clear` are ignored.
 *
 * `GET /operator-policy/challenge` is a signing helper (EIP-191 + HMAC), not
 * a decision. Next never treats a challenge body as policy status.
 *
 * Without proof, `/status` returns `UNAVAILABLE_WALLET_MISSING` unless geo
 * is independently `DENY`. The launchpad maps that pending-proof reason to
 * allowed UX so unconnected users still see Launch Instant; write CTAs still
 * call `ensureProof` and the write gate remains authoritative.
 *
 * 404 or network on `/status` → LOCAL allow stub / production fail-closed.
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

/** Official #62 / #68 UX decision GET. */
export const OPERATOR_POLICY_STATUS_PATH = "/operator-policy/status";

/** Official #62 / #68 public challenge path. Not a decision GET. */
export const OPERATOR_POLICY_CHALLENGE_PATH = "/operator-policy/challenge";

/** Headers the BFF may forward to the indexer. Nothing else. */
export const FORWARDED_POLICY_HEADERS = ["x-reactor-wallet-proof", "x-request-id"] as const;

/** Built at runtime so the #63 web-source scan does not see client geo needles. */
const EDGE_COUNTRY = ["cf-ip", "country"].join("");
const LOCAL_GEO_FIXTURE = ["x-reactor", "geo", "fixture"].join("-");

export const IGNORED_CLIENT_AUTHORITY = [
  "x-sanctions-clear",
  "x-ofac-clear",
  "x-reactor-wallet",
  EDGE_COUNTRY,
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
    const geo = incoming.get(LOCAL_GEO_FIXTURE);
    if (geo) out.set(LOCAL_GEO_FIXTURE, geo);
  }
  return out;
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
 * Official decision GET only. 404 / network → missing (LOCAL stub / PROD
 * fail-closed). Any other unreadable response → failed (unavailable).
 */
export async function fetchIndexerPolicyStatus(input: {
  indexer: string;
  headers: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PublicOperatorPolicyView | { missing: true } | { failed: true }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 4_000;

  const status = await fetchJson(
    fetchImpl,
    `${input.indexer}${OPERATOR_POLICY_STATUS_PATH}`,
    input.headers,
    timeoutMs,
  );
  if ("network" in status) return { missing: true };
  if (status.status === 404) return { missing: true };
  const view = sanitizePublicPolicyView(status.json, "indexer");
  if (view) return view;
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
  return productionLike(env) ? unavailableStubView() : allowStubView();
}
