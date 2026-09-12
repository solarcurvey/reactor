/**
 * #65 status + write gate bound to the #62 / PR #68 recovered-wallet model.
 *
 * Public reads: GET /operator-policy/challenge, GET /operator-policy/status.
 * Status is minimized (no IP / SDN / list metadata). Subject is the recovered
 * EIP-191 signer of a server challenge — never x-reactor-wallet / body.wallet.
 *
 * If official `operator-policy.ts` from PR #68 is present, challenge/recover/gate
 * delegate to it. Otherwise this module is the compatible bind.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { productionHardGatesApply } from "./prod-gates.ts";
import {
  evaluateOperatorPolicy,
  publicPolicyBody,
  type AddressScreenResult,
  type GeoPolicyResult,
  type OperatorPolicyDecision,
} from "../../../packages/reactor/src/operator-policy-evaluate.ts";
import { normalizeEvmAddress, publicPolicyView } from "../../../packages/reactor/src/operator-policy-ux.ts";
import {
  issueWalletProofChallenge,
  readWalletProofParts,
  recoverWalletProof,
  type WalletProofChallenge,
} from "../../../packages/reactor/src/wallet-proof.ts";

export type HeaderMap = Record<string, string | string[] | undefined>;

export const FIXTURE_DENIED_ISO = new Set(["FX"]);
export const FIXTURE_DENIED_REGIONS = new Set(["FY-99"]);

const UNTRUSTED_WALLET_HEADERS = ["x-reactor-wallet", "x-wallet", "wallet"] as const;

type OfficialBind = {
  issueOperatorWalletChallenge?: (env?: NodeJS.ProcessEnv) => WalletProofChallenge | { error: string };
  recoverSubjectWallet?: (input: {
    headers: HeaderMap;
    body?: Record<string, unknown>;
    env?: NodeJS.ProcessEnv;
  }) => Promise<{ address?: string; reason?: string }>;
  gateProtectedWrite?: (input: {
    headers: HeaderMap;
    body?: Record<string, unknown>;
    env?: NodeJS.ProcessEnv;
    surface: string;
  }) => Promise<PolicyGateAllow | PolicyGateDeny>;
  fixtureScreenAddress?: (address: string, env?: NodeJS.ProcessEnv) => AddressScreenResult;
  fixtureEvaluateGeo?: (headers: HeaderMap, env?: NodeJS.ProcessEnv) => GeoPolicyResult;
};

let official: OfficialBind | null = null;
let officialChecked = false;
let blockedWallets = new Set<string>();

export function resetOperatorPolicyBindState(): void {
  official = null;
  officialChecked = false;
  blockedWallets = new Set();
}

export function setFixtureBlockedWallets(addresses: string[]): void {
  blockedWallets = new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
}

export async function tryBindOfficialOperatorPolicy(dir?: string): Promise<boolean> {
  if (officialChecked) return official != null;
  officialChecked = true;
  const base = dir ?? dirname(fileURLToPath(import.meta.url));
  const file = join(base, "operator-policy.ts");
  if (!existsSync(file)) return false;
  try {
    official = (await import(file)) as OfficialBind;
    return true;
  } catch {
    official = null;
    return false;
  }
}

function header(headers: HeaderMap, name: string): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return v == null ? "" : String(v).trim();
}

export function incomingHeaders(req: { headers: HeaderMap }): HeaderMap {
  return req.headers;
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
  if (official?.issueOperatorWalletChallenge) {
    return official.issueOperatorWalletChallenge(env);
  }
  const secret = walletProofSecret(env);
  if (!secret) return { error: "wallet proof secret unavailable" };
  return issueWalletProofChallenge({ chainId: walletProofChainId(env), secret, nowSec });
}

export async function recoverSubjectWallet(input: {
  headers: HeaderMap;
  body?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}): Promise<{ address?: string; reason?: "wallet_missing" | "wallet_invalid" | "wallet_proof_stale" }> {
  if (official?.recoverSubjectWallet) {
    const out = await official.recoverSubjectWallet(input);
    if (out.address) return { address: out.address };
    const reason = out.reason;
    if (reason === "wallet_missing" || reason === "wallet_invalid" || reason === "wallet_proof_stale") {
      return { reason };
    }
    return { reason: "wallet_missing" };
  }
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

function envBlocked(env: NodeJS.ProcessEnv): string[] {
  return (env.OPERATOR_POLICY_BLOCKED_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function fixtureScreenAddress(address: string, env: NodeJS.ProcessEnv = process.env): AddressScreenResult {
  if (official?.fixtureScreenAddress) return official.fixtureScreenAddress(address, env);
  const freshness = (env.OPERATOR_POLICY_DATASET_FRESHNESS as AddressScreenResult["freshness"] | undefined) ?? "current";
  if (freshness === "missing") {
    return { decision: "unavailable", reason: "missing_dataset", freshness: "missing" };
  }
  const key = address.toLowerCase();
  if (blockedWallets.has(key) || envBlocked(env).includes(key)) {
    return { decision: "blocked", freshness };
  }
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

export function fixtureEvaluateGeo(headers: HeaderMap, env: NodeJS.ProcessEnv = process.env): GeoPolicyResult {
  if (official?.fixtureEvaluateGeo) return official.fixtureEvaluateGeo(headers, env);
  const claim = header(headers, "x-reactor-geo-fixture");
  if (claim && !productionHardGatesApply(env)) {
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
  const fallback = (env.OPERATOR_POLICY_LOCAL_DEFAULT_GEO ?? "ALLOW").toString().toUpperCase();
  if (fallback === "UNKNOWN") return { decision: "UNKNOWN", reason: "UNKNOWN_MISSING_GEO" };
  return { decision: "ALLOW", reason: "ALLOW_JURISDICTION_NOT_LISTED" };
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

function ignoredClientSignals(headers: HeaderMap, body?: Record<string, unknown>): string[] {
  const ignored: string[] = [];
  for (const name of UNTRUSTED_WALLET_HEADERS) {
    if (header(headers, name)) ignored.push(name);
  }
  if (body) {
    for (const key of ["wallet", "creator", "recipient", "account", "sanctionsClear", "ofacClear", "country"]) {
      if (body[key] !== undefined) ignored.push(`body.${key}`);
    }
  }
  return ignored;
}

export async function gateProtectedWrite(input: {
  headers: HeaderMap;
  body?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  surface: string;
}): Promise<PolicyGateAllow | PolicyGateDeny> {
  await tryBindOfficialOperatorPolicy();
  if (official?.gateProtectedWrite) {
    return official.gateProtectedWrite(input);
  }
  const env = input.env ?? process.env;
  const ignored = ignoredClientSignals(input.headers, input.body);
  const recovered = await recoverSubjectWallet({ headers: input.headers, body: input.body, env });
  const wallet = recovered.address;
  const addressScreen: AddressScreenResult = wallet
    ? fixtureScreenAddress(wallet, env)
    : { decision: "unavailable", reason: recovered.reason ?? "wallet_missing", freshness: "missing" };
  const geo = fixtureEvaluateGeo(input.headers, env);
  const decision = evaluateOperatorPolicy({ addressScreen, geo });
  if (decision.decision === "allow" && wallet) {
    return { ok: true, wallet, decision, ignored };
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
 * Minimized public status. Proof is optional so geo denial can disable CTAs
 * before a wallet prompt. Account screening runs only on a recovered signer.
 */
export async function evaluateOperatorPolicyStatus(input: {
  headers: HeaderMap;
  env?: NodeJS.ProcessEnv;
  requireWallet?: boolean;
}): Promise<OperatorPolicyDecision> {
  await tryBindOfficialOperatorPolicy();
  const env = input.env ?? process.env;
  const requireWallet = Boolean(input.requireWallet);
  const recovered = await recoverSubjectWallet({ headers: input.headers, env });
  const addressScreen: AddressScreenResult = recovered.address
    ? fixtureScreenAddress(recovered.address, env)
    : requireWallet
      ? { decision: "unavailable", reason: recovered.reason ?? "wallet_missing", freshness: "missing" }
      : { decision: "clear", freshness: "current" };
  const geo = fixtureEvaluateGeo(input.headers, env);
  return evaluateOperatorPolicy({ addressScreen, geo });
}

export function minimizedStatusBody(decision: OperatorPolicyDecision): Record<string, unknown> {
  const view = publicPolicyView({
    reason: decision.reason,
    source: "indexer",
    error: decision.userMessage,
  });
  return { ...view, httpStatus: decision.httpStatus };
}

export function claimedWalletIgnored(headers: HeaderMap, body?: Record<string, unknown>): boolean {
  if (header(headers, "x-reactor-wallet")) return true;
  if (body && (body.wallet || body.creator || body.recipient || body.account)) return true;
  return Boolean(normalizeEvmAddress(header(headers, "x-reactor-wallet")));
}
