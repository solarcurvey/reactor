/**
 * Server-side enforcement for issue #62.
 *
 * Routes call `gateProtectedWrite` once. Do not copy allow/deny checks
 * into /quote, /launch/*, /upload, or the isolated signer.
 *
 * Address screening and trusted geo are injected:
 *   - official #61 / #63 modules via `tryBindOfficialPolicyPlugins`
 *   - LOCAL fixture providers (deterministic; not production authority)
 *   - production without plugins fail-closes (unavailable)
 *
 * Browser JSON / query / `x-sanctions-clear` / `CF-IPCountry` /
 * `x-reactor-wallet` / body.wallet never become the screened subject.
 * Subject is the EIP-191 recovered signer of a server-issued challenge.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { productionHardGatesApply } from "./prod-gates.ts";
import {
  evaluateOperatorPolicy,
  normalizeEvmAddress,
  publicPolicyBody,
  publicStatusView,
  type AddressScreenResult,
  type GeoPolicyResult,
  type OperatorPolicyDecision,
} from "../../../packages/reactor/src/sanctions-policy.ts";
import {
  issueWalletProofChallenge,
  readWalletProofParts,
  recoverWalletProof,
  type WalletProofChallenge,
} from "../../../packages/reactor/src/wallet-proof.ts";

export {
  evaluateOperatorPolicy,
  publicPolicyBody,
  publicStatusView,
  uxKindForReason,
  normalizeEvmAddress,
  OPERATOR_POLICY_ID,
  OPERATOR_POLICY_DISCLAIMER,
  USER_POLICY_MESSAGES,
} from "../../../packages/reactor/src/sanctions-policy.ts";

export type HeaderMap = Record<string, string | string[] | undefined>;

export const OPERATOR_POLICY_PROTECTED_WRITES = [
  { method: "POST", pathname: "/launch/admit" },
  { method: "POST", pathname: "/launch/authorize" },
  { method: "POST", pathname: "/quote" },
  { method: "POST", pathname: "/upload" },
] as const;

/** Isolated signer: every POST except documented read health. */
export const OPERATOR_POLICY_SIGNER_WRITES = [{ method: "POST", pathname: "/" }] as const;

export const OPERATOR_POLICY_PUBLIC_READS = [
  { method: "GET", pathname: "/health" },
  { method: "GET", pathname: "/markets" },
  { method: "GET", pathname: "/quote-assets" },
  { method: "GET", pathname: "/valuation" },
  { method: "GET", pathname: "/top10" },
  { method: "GET", pathname: "/pricing/health" },
  { method: "GET", pathname: "/stream" },
  { method: "GET", pathname: "/ticker" },
  { method: "GET", pathname: "/candles" },
  { method: "GET", pathname: "/swaps" },
  { method: "GET", pathname: "/m" },
] as const;

/** Client-supplied flags that must never become authority. */
export const UNTRUSTED_POLICY_HEADER_NAMES = [
  "x-sanctions-clear",
  "x-sanctions-decision",
  "x-ofac-clear",
  "x-ofac-status",
  "x-compliance-ok",
  "cf-ipcountry",
  "cf-region",
  "cf-region-code",
  "cf-connecting-ip",
  "x-country",
  "x-country-code",
  "x-geo-country",
  "x-appengine-country",
  "x-vercel-ip-country",
  "x-forwarded-country",
  "cloudfront-viewer-country",
  "true-client-ip",
  "x-real-ip",
  "x-forwarded-for",
  "x-reactor-wallet",
] as const;

const UNTRUSTED_BODY_KEYS = [
  "sanctionsClear",
  "ofacClear",
  "sanctions",
  "ofac",
  "country",
  "geoCountry",
  "ipCountry",
  "complianceOk",
  "blocked",
  "clear",
  "wallet",
  "creator",
  "recipient",
  "account",
] as const;

/** Same fixture deny ISOs as issue #63 LOCAL policy (FX / FY-99). */
export const FIXTURE_DENIED_ISO = new Set(["FX"]);
export const FIXTURE_DENIED_REGIONS = new Set(["FY-99"]);

export type AddressScreener = {
  screen(address: string): AddressScreenResult | Promise<AddressScreenResult>;
};

export type GeoEvaluator = {
  evaluate(headers: HeaderMap, env?: NodeJS.ProcessEnv): GeoPolicyResult;
};

export type OperatorPolicyProviders = {
  screenAddress: AddressScreener["screen"];
  evaluateGeo: GeoEvaluator["evaluate"];
};

export type FixturePolicyState = {
  blockedWallets: Set<string>;
  freshness: AddressScreenResult["freshness"];
  /** LOCAL only: geo when no trusted fixture claim is present. */
  localDefaultGeo: "ALLOW" | "UNKNOWN";
};

const defaultFixture = (): FixturePolicyState => ({
  blockedWallets: new Set(),
  freshness: "current",
  localDefaultGeo: "ALLOW",
});

let fixture: FixturePolicyState = defaultFixture();
let bound: OperatorPolicyProviders | null = null;
let officialBound = false;

export function resetOperatorPolicyState(): void {
  fixture = defaultFixture();
  bound = null;
  officialBound = false;
}

export function setFixtureBlockedWallets(addresses: string[]): void {
  fixture.blockedWallets = new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
}

export function setFixtureDatasetFreshness(freshness: AddressScreenResult["freshness"]): void {
  fixture.freshness = freshness;
}

export function setFixtureLocalDefaultGeo(value: "ALLOW" | "UNKNOWN"): void {
  fixture.localDefaultGeo = value;
}

export function bindOperatorPolicyProviders(providers: OperatorPolicyProviders | null): void {
  bound = providers;
}

export function officialPolicyPluginsBound(): boolean {
  return officialBound;
}

function header(headers: HeaderMap, name: string): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return v == null ? "" : String(v).trim();
}

function envBlockedWallets(env: NodeJS.ProcessEnv): string[] {
  return (env.OPERATOR_POLICY_BLOCKED_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function fixtureScreenAddress(address: string, env: NodeJS.ProcessEnv = process.env): AddressScreenResult {
  const freshness = (env.OPERATOR_POLICY_DATASET_FRESHNESS as AddressScreenResult["freshness"] | undefined) ?? fixture.freshness;
  if (freshness === "missing") {
    return { decision: "unavailable", reason: "missing_dataset", freshness: "missing" };
  }
  const key = address.toLowerCase();
  const blocked = fixture.blockedWallets.has(key) || envBlockedWallets(env).includes(key);
  if (blocked) return { decision: "blocked", freshness };
  if (freshness === "stale") {
    return { decision: "unavailable", reason: "stale_dataset", freshness: "stale" };
  }
  return { decision: "clear", freshness: "current" };
}

function parseFixtureGeoClaim(raw: string): { country?: string; region?: string } {
  if (!raw.includes("=") && !raw.includes(";")) {
    return { country: raw.trim().toUpperCase() || undefined };
  }
  const fields = Object.fromEntries(
    raw.split(";").map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? [p.trim().toLowerCase(), ""] : [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
    }),
  );
  return {
    country: (fields.country ?? "").trim().toUpperCase() || undefined,
    region: (fields.region ?? "").trim().toUpperCase() || undefined,
  };
}

/**
 * LOCAL / test geo. Honors `x-reactor-geo-fixture` only (same name as #63).
 * Production must use the official #63 evaluator — this function is never
 * production authority.
 */
export function fixtureEvaluateGeo(headers: HeaderMap, env: NodeJS.ProcessEnv = process.env): GeoPolicyResult {
  const claim = header(headers, "x-reactor-geo-fixture");
  if (claim) {
    const parsed = parseFixtureGeoClaim(claim);
    if (parsed.country && FIXTURE_DENIED_ISO.has(parsed.country)) {
      return { decision: "DENY", reason: "DENY_COMPREHENSIVE_JURISDICTION" };
    }
    if (parsed.region && FIXTURE_DENIED_REGIONS.has(parsed.region)) {
      return { decision: "DENY", reason: "DENY_COMPREHENSIVE_REGION" };
    }
    if (parsed.country && /^[A-Z0-9]{2}$/.test(parsed.country)) {
      return { decision: "ALLOW", reason: "ALLOW_JURISDICTION_NOT_LISTED" };
    }
    return { decision: "UNKNOWN", reason: "UNKNOWN_INVALID_CLAIM" };
  }
  if (productionHardGatesApply(env)) {
    return { decision: "UNKNOWN", reason: "UNKNOWN_UNTRUSTED_SOURCE" };
  }
  const fallback = (env.OPERATOR_POLICY_LOCAL_DEFAULT_GEO ?? fixture.localDefaultGeo).toString().toUpperCase();
  if (fallback === "UNKNOWN") return { decision: "UNKNOWN", reason: "UNKNOWN_MISSING_GEO" };
  return { decision: "ALLOW", reason: "ALLOW_JURISDICTION_NOT_LISTED" };
}

function failClosedAddress(): AddressScreenResult {
  return { decision: "unavailable", reason: "missing_dataset", freshness: "missing" };
}

function failClosedGeo(): GeoPolicyResult {
  return { decision: "UNKNOWN", reason: "UNKNOWN_UNTRUSTED_SOURCE" };
}

function defaultProviders(env: NodeJS.ProcessEnv): OperatorPolicyProviders {
  if (productionHardGatesApply(env) && !officialBound && !bound) {
    return {
      screenAddress: () => failClosedAddress(),
      evaluateGeo: () => failClosedGeo(),
    };
  }
  return {
    screenAddress: (address) => fixtureScreenAddress(address, env),
    evaluateGeo: (headers) => fixtureEvaluateGeo(headers, env),
  };
}

function providers(env: NodeJS.ProcessEnv): OperatorPolicyProviders {
  if (bound) return bound;
  return defaultProviders(env);
}

export function isProtectedWritePath(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  const p = pathname.replace(/\/+$/, "") || "/";
  if (OPERATOR_POLICY_PROTECTED_WRITES.some((r) => r.method === m && r.pathname === p)) return true;
  if (p.startsWith("/ticker/") || p.startsWith("/candles/") || p.startsWith("/swaps/") || p.startsWith("/m/")) {
    return false;
  }
  return false;
}

export function isPublicReadPath(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/health" || p === "/markets" || p === "/quote-assets" || p === "/valuation" || p === "/top10") return true;
  if (p === "/operator-policy/challenge" || p === "/operator-policy/status") return true;
  if (p === "/pricing/health" || p === "/stream" || p === "/events" || p === "/reactor" || p === "/keeper") return true;
  if (p.startsWith("/ticker/") || p.startsWith("/candles/") || p.startsWith("/swaps/") || p.startsWith("/m/")) return true;
  return false;
}

export function claimedClientWallet(input: { headers: HeaderMap; body?: Record<string, unknown> }): string | undefined {
  const body = input.body ?? {};
  const candidates = [body.wallet, body.creator, body.recipient, body.account, header(input.headers, "x-reactor-wallet")];
  for (const c of candidates) {
    const n = normalizeEvmAddress(typeof c === "string" ? c : undefined);
    if (n) return n;
  }
  return undefined;
}

/**
 * @deprecated Client-supplied wallet is not authority. Use recoverSubjectWallet.
 */
export function extractSubjectWallet(input: { headers: HeaderMap; body?: Record<string, unknown> }): string | undefined {
  void input;
  return undefined;
}

export function walletProofSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.OPERATOR_POLICY_HMAC_SECRET?.trim() || env.ADMISSION_HMAC_SECRET?.trim() || "";
  if (s.length >= 16) return s;
  if (!productionHardGatesApply(env)) return "local-operator-policy-hmac-do-not-use-in-prod";
  return "";
}

export function walletProofChainId(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CHAIN_ID ?? env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);
  return Number.isInteger(n) && n > 0 ? n : 5042002;
}

export function issueOperatorWalletChallenge(
  env: NodeJS.ProcessEnv = process.env,
  nowSec: number = Math.floor(Date.now() / 1000),
): WalletProofChallenge | { error: string } {
  const secret = walletProofSecret(env);
  if (!secret) return { error: "wallet proof secret unavailable" };
  return issueWalletProofChallenge({ chainId: walletProofChainId(env), secret, nowSec });
}

export async function recoverSubjectWallet(input: {
  headers: HeaderMap;
  body?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}): Promise<{ address?: string; reason?: "wallet_missing" | "wallet_invalid" | "wallet_proof_stale" }> {
  const env = input.env ?? process.env;
  const secret = walletProofSecret(env);
  if (!secret) return { reason: "wallet_missing" };
  const parts = readWalletProofParts({
    headerProof: header(input.headers, "x-reactor-wallet-proof"),
    body: input.body,
  });
  if (!parts) return { reason: "wallet_missing" };
  const recovered = await recoverWalletProof({
    token: parts.token,
    signature: parts.signature,
    secret,
    expectedChainId: walletProofChainId(env),
  });
  if (!recovered.ok) return { reason: recovered.reason };
  return { address: recovered.address };
}

/** Downstream artifacts must use the recovered signer, not the claimed wallet. */
export function bindRecoveredIdentity(body: Record<string, unknown>, wallet: string): void {
  body.wallet = wallet;
  body.creator = wallet;
  body.recipient = wallet;
  body.account = wallet;
}

function ignoredClientSignals(headers: HeaderMap, body?: Record<string, unknown>): string[] {
  const ignored: string[] = [];
  for (const name of UNTRUSTED_POLICY_HEADER_NAMES) {
    if (header(headers, name)) ignored.push(name);
  }
  if (body) {
    for (const key of UNTRUSTED_BODY_KEYS) {
      if (body[key] !== undefined) ignored.push(`body.${key}`);
    }
  }
  return ignored;
}

export type PolicyGateAllow = {
  ok: true;
  wallet: string;
  decision: OperatorPolicyDecision;
  ignored: string[];
};

export type PolicyGateDeny = {
  ok: false;
  status: 403 | 503;
  body: Record<string, unknown>;
  decision: OperatorPolicyDecision;
  ranDownstream: false;
};

export async function gateProtectedWrite(input: {
  headers: HeaderMap;
  body?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  surface: string;
}): Promise<PolicyGateAllow | PolicyGateDeny> {
  const env = input.env ?? process.env;
  const ignored = ignoredClientSignals(input.headers, input.body);
  const claimed = claimedClientWallet({ headers: input.headers, body: input.body });
  if (claimed) ignored.push("claimed-wallet");
  const recovered = await recoverSubjectWallet({ headers: input.headers, body: input.body, env });
  const wallet = recovered.address;
  const p = providers(env);

  const addressScreen: AddressScreenResult = wallet
    ? await p.screenAddress(wallet)
    : { decision: "unavailable", reason: recovered.reason ?? "wallet_missing", freshness: "missing" };
  const geo = p.evaluateGeo(input.headers, env);
  const decision = evaluateOperatorPolicy({ addressScreen, geo });

  if (decision.decision === "allow") {
    return { ok: true, wallet: wallet!, decision, ignored };
  }
  return {
    ok: false,
    status: decision.httpStatus === 403 ? 403 : 503,
    body: publicPolicyBody(decision, { surface: input.surface }),
    decision,
    ranDownstream: false,
  };
}

/**
 * Public decision read for #65 / PR #75. Same `evaluateOperatorPolicy` as writes.
 * Optional `x-reactor-wallet-proof` screens the recovered signer. Claimed wallet
 * strings are ignored. Response is the minimized `publicStatusView` only.
 */
export async function readOperatorPolicyStatus(input: {
  headers: HeaderMap;
  env?: NodeJS.ProcessEnv;
}): Promise<{ status: 200 | 403 | 503; body: Record<string, unknown> }> {
  const gate = await gateProtectedWrite({
    headers: input.headers,
    env: input.env,
    surface: "operator-policy.status",
  });
  return { status: gate.decision.httpStatus, body: publicStatusView(gate.decision) };
}

/**
 * Optional #61 / #63 bind. Missing modules are not an error — production
 * then fail-closes until those plugins exist.
 */
export async function tryBindOfficialPolicyPlugins(
  env: NodeJS.ProcessEnv = process.env,
  pluginDir?: string,
): Promise<{ address: boolean; geo: boolean }> {
  const dir = pluginDir ?? dirname(fileURLToPath(import.meta.url));
  let address = false;
  let geo = false;
  let screenFn: OperatorPolicyProviders["screenAddress"] | undefined;
  let geoFn: OperatorPolicyProviders["evaluateGeo"] | undefined;

  const sanctionsPath = join(dir, "sanctions.ts");
  if (existsSync(sanctionsPath)) {
    try {
      const mod = (await import(sanctionsPath)) as {
        indexerSanctionsStore?: () => { screen: (address: string) => { decision: string; reason?: string; freshness: string } };
      };
      if (typeof mod.indexerSanctionsStore === "function") {
        const store = mod.indexerSanctionsStore();
        if (typeof store.screen === "function") {
          screenFn = (addressIn: string) => {
            const r = store.screen(addressIn);
            return {
              decision: r.decision as AddressScreenResult["decision"],
              reason: r.reason,
              freshness: r.freshness as AddressScreenResult["freshness"],
            };
          };
          address = true;
        }
      }
    } catch {
      /* plugin optional */
    }
  }

  const geoPath = join(dir, "geo-policy-resolve.ts");
  if (existsSync(geoPath)) {
    try {
      const mod = (await import(geoPath)) as {
        evaluateRequestGeo?: (headers: HeaderMap, env?: NodeJS.ProcessEnv) => { decision: string; reason: string };
      };
      if (typeof mod.evaluateRequestGeo === "function") {
        geoFn = (headers, e) => {
          const r = mod.evaluateRequestGeo!(headers, e ?? env);
          return { decision: r.decision as GeoPolicyResult["decision"], reason: r.reason };
        };
        geo = true;
      }
    } catch {
      /* plugin optional */
    }
  }

  if (address || geo) {
    const fallback = defaultProviders(env);
    bindOperatorPolicyProviders({
      screenAddress: screenFn ?? fallback.screenAddress,
      evaluateGeo: geoFn ?? fallback.evaluateGeo,
    });
    officialBound = address && geo;
  }
  return { address, geo };
}

export const CORS_POLICY_HEADERS = "content-type,x-request-id,authorization,x-ops-token,x-reactor-wallet-proof,x-reactor-geo-fixture,x-reactor-geo,x-reactor-geo-ts,x-reactor-geo-country,x-reactor-geo-region,x-reactor-geo-region-name,x-reactor-geo-anonymizer,x-reactor-geo-ip,x-reactor-geo-mac";
