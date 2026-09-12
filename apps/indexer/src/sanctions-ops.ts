/**
 * Indexer wiring for sanctions freshness, health, alerts, and audit (issue #64).
 *
 * Binds official #61 / #62 / #63 modules when those files exist.
 * Last-known-good + SLA live in `@reactor/core` `SanctionsOps`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GEO_POLICY_VERSION_DEFAULT,
  SANCTIONS_DATASET_SLA_MS,
  SANCTIONS_REFRESH_INTERVAL_MS,
  SanctionsOps,
  fixtureRefreshPayload,
  type FailureInject,
  type RefreshPayload,
  type SanctionsAlert,
  type SanctionsHealth,
} from "../../../packages/reactor/src/sanctions-ops.ts";
import type { CoarsePolicyAction } from "../../../packages/reactor/src/sanctions-audit.ts";
import { OPERATOR_POLICY_ID, type OperatorPolicyDecision } from "../../../packages/reactor/src/sanctions-policy.ts";
import { readWalletProofParts, recoverWalletProof } from "../../../packages/reactor/src/wallet-proof.ts";
import { raiseAlert } from "./alerts.ts";
import type { Store } from "./db.ts";
import { logLine } from "./obs.ts";
import { isLocalEnv, productionHardGatesApply } from "./prod-gates.ts";

export const SANCTIONS_OPS_PROTECTED = [
  { method: "POST", pathname: "/quote", action: "quote" },
  { method: "POST", pathname: "/upload", action: "upload" },
  { method: "POST", pathname: "/launch/admit", action: "launch.admit" },
  { method: "POST", pathname: "/launch/authorize", action: "launch.authorize" },
] as const;

export type HeaderMap = Record<string, string | string[] | undefined>;

function header(headers: HeaderMap, name: string): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return v == null ? "" : String(v).trim();
}

/**
 * @deprecated Client-supplied wallet is not authority (same as #68 `extractSubjectWallet`).
 * Always returns `undefined`. Use `recoverOfficialSubject`.
 */
export function extractWallet(_input: { headers: HeaderMap; body?: Record<string, unknown> }): string | undefined {
  void _input;
  return undefined;
}

/** Same HMAC selection as #68 `walletProofSecret`. */
export function walletProofSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.OPERATOR_POLICY_HMAC_SECRET?.trim() || env.ADMISSION_HMAC_SECRET?.trim() || "";
  if (s.length >= 16) return s;
  if (!productionHardGatesApply(env)) return "local-operator-policy-hmac-do-not-use-in-prod";
  return "";
}

/** Same chain selection as #68 `walletProofChainId`. */
export function walletProofChainId(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CHAIN_ID ?? env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);
  return Number.isInteger(n) && n > 0 ? n : 5042002;
}

function resolveInject(env: NodeJS.ProcessEnv): FailureInject {
  const raw = (env.SANCTIONS_INJECT ?? "none").toLowerCase();
  if (raw === "stale" || raw === "refresh_fail" || raw === "policy_fail" || raw === "partial_refresh") return raw;
  return "none";
}

/**
 * Fixture refresh is LOCAL / explicit test only.
 * PROD, PRODUCTION, STAGING, TESTNET (and NODE_ENV=production) must use the
 * official #61 source or report unavailable/stale. `SANCTIONS_FIXTURE=1` cannot
 * override a production-like env.
 */
export function allowFixtureSanctionsRefresh(env: NodeJS.ProcessEnv = process.env): boolean {
  if (productionHardGatesApply(env)) return false;
  return isLocalEnv(env) || env.SANCTIONS_FIXTURE === "1";
}

function defaultFetcher(env: NodeJS.ProcessEnv): (() => Promise<RefreshPayload>) | undefined {
  if (!allowFixtureSanctionsRefresh(env)) return undefined;
  return async () => fixtureRefreshPayload(new Date().toISOString());
}

type OfficialPolicyPlugin = {
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
  }) => Promise<
    | { ok: true; wallet: string; decision: OperatorPolicyDecision; ignored: string[] }
    | { ok: false; status: 403 | 503; body: Record<string, unknown>; decision: OperatorPolicyDecision; ranDownstream: false }
  >;
};

async function loadOperatorPolicyPlugin(): Promise<OfficialPolicyPlugin | null> {
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = join(dir, "operator-policy.ts");
  if (!existsSync(path)) return null;
  try {
    return (await import(path)) as OfficialPolicyPlugin;
  } catch {
    return null;
  }
}

async function recoverWalletProofSubject(input: {
  headers: HeaderMap;
  body?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}): Promise<{ address?: string; reason?: string }> {
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

/**
 * Canonical subject is the #68/#62 recovered EIP-191 signer.
 * Prefer `operator-policy.ts` when present; otherwise the shared wallet-proof interface.
 * Claimed body/header wallets are never identity.
 */
export async function recoverOfficialSubject(input: {
  headers: HeaderMap;
  body?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}): Promise<{ address?: string; reason?: string; source: "operator-policy" | "wallet-proof" }> {
  const plugin = await loadOperatorPolicyPlugin();
  if (typeof plugin?.recoverSubjectWallet === "function") {
    const recovered = await plugin.recoverSubjectWallet({
      headers: input.headers,
      body: input.body,
      env: input.env,
    });
    return { ...recovered, source: "operator-policy" };
  }
  return { ...(await recoverWalletProofSubject(input)), source: "wallet-proof" };
}

function opsOwnedFailClosed(reason: string): boolean {
  return (
    reason === "UNAVAILABLE_DATASET_STALE" ||
    reason === "UNAVAILABLE_DATASET_MISSING" ||
    reason === "OPERATED_WRITES_DISABLED" ||
    reason === "UNAVAILABLE_ADDRESS_SCREEN"
  );
}

/**
 * HTTP gate for #64 freshness/audit. Identity and allow/deny come from #62
 * when `operator-policy.ts` is present. Browser-claimed wallets never gate.
 */
export async function applySanctionsOpsGate(input: {
  ops: SanctionsOps;
  action: CoarsePolicyAction;
  headers: HeaderMap;
  body?: Record<string, unknown>;
  requestId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ReturnType<SanctionsOps["gateProtectedWrite"]>> {
  const plugin = await loadOperatorPolicyPlugin();
  const recovered = await recoverOfficialSubject({
    headers: input.headers,
    body: input.body,
    env: input.env,
  });

  let official: Awaited<ReturnType<NonNullable<OfficialPolicyPlugin["gateProtectedWrite"]>>> | null = null;
  if (typeof plugin?.gateProtectedWrite === "function") {
    official = await plugin.gateProtectedWrite({
      headers: input.headers,
      body: input.body,
      env: input.env,
      surface: input.action,
    });
  }

  const subject = official && official.ok ? official.wallet : recovered.address;
  const opsGate = input.ops.gateProtectedWrite({
    action: input.action,
    recoveredWallet: subject,
    headers: input.headers,
    body: input.body,
    requestId: input.requestId,
  });

  const opsReason = !opsGate.ok && "reason" in opsGate.decision ? opsGate.decision.reason : "";
  if (!opsGate.ok && (opsOwnedFailClosed(opsReason) || !official || official.ok)) {
    return opsGate;
  }
  if (official && !official.ok) {
    return {
      ok: false,
      status: official.status,
      decision: official.decision,
      body: official.body,
      audit: opsGate.audit,
      ranDownstream: false,
      ignored: opsGate.ignored,
    };
  }
  return opsGate;
}

async function tryOfficialFetcher(): Promise<(() => Promise<RefreshPayload>) | undefined> {
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = join(dir, "sanctions.ts");
  if (!existsSync(path)) return undefined;
  try {
    const mod = (await import(path)) as {
      opsRefreshSanctions?: (store: { active?: () => { version?: RefreshPayload } }) => Promise<{
        ok: boolean;
        error?: string;
        version?: { id: string; retrievedAt: string; sources: RefreshPayload["sources"]; contentHash: string; addressCount: number };
      }>;
      indexerSanctionsStore?: () => {
        active: () => { version: { retrievedAt: string; sources: RefreshPayload["sources"]; contentHash: string; addressCount: number }; index: Map<string, { family: string; canonicalKey: string }> } | null;
      };
    };
    if (typeof mod.opsRefreshSanctions === "function" && typeof mod.indexerSanctionsStore === "function") {
      return async () => {
        const store = mod.indexerSanctionsStore!();
        const result = await mod.opsRefreshSanctions!(store);
        if (!result.ok) throw new Error(result.error ?? "official refresh failed");
        const active = store.active();
        if (!active) throw new Error("official refresh did not activate");
        return {
          retrievedAt: active.version.retrievedAt,
          sources: active.version.sources,
          addresses: [...active.index.values()].map((a) => ({ family: a.family, canonicalKey: a.canonicalKey })),
        };
      };
    }
  } catch {
    /* official #61 plugin optional */
  }
  return undefined;
}

export function isProtectedWritePath(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  const p = pathname.replace(/\/+$/, "") || "/";
  return SANCTIONS_OPS_PROTECTED.some((r) => r.method === m && r.pathname === p);
}

export function protectedAction(pathname: string): (typeof SANCTIONS_OPS_PROTECTED)[number]["action"] | undefined {
  const p = pathname.replace(/\/+$/, "") || "/";
  return SANCTIONS_OPS_PROTECTED.find((r) => r.pathname === p)?.action;
}

export async function createSanctionsOps(
  store: Store | { run?: Store["run"] } | null,
  env: NodeJS.ProcessEnv = process.env,
  opts: { dataDir?: string; now?: () => number; fetchOfficialList?: () => Promise<RefreshPayload> } = {},
): Promise<SanctionsOps> {
  const dataDir = opts.dataDir ?? env.SANCTIONS_DATA_DIR ?? new URL("../data/sanctions", import.meta.url).pathname;
  const official = opts.fetchOfficialList ?? (await tryOfficialFetcher()) ?? defaultFetcher(env);
  const ops = new SanctionsOps({
    dataDir,
    maxAgeMs: Number(env.SANCTIONS_MAX_AGE_MS ?? SANCTIONS_DATASET_SLA_MS),
    now: opts.now,
    geoPolicyVersion: env.GEO_POLICY_VERSION ?? GEO_POLICY_VERSION_DEFAULT,
    fetchOfficialList: official,
    inject: resolveInject(env),
    log: (line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        logLine({ kind: "sanctions_audit", ...parsed });
      } catch {
        logLine({ kind: "sanctions_audit", raw: line });
      }
    },
    raiseAlert: async (alert: SanctionsAlert) => {
      if (store && typeof store.run === "function") {
        await raiseAlert(store as Store, alert.level, alert.code, alert.detail);
      } else {
        logLine({ kind: "alert", level: alert.level, code: alert.code, detail: alert.detail });
      }
    },
  });
  if (env.SANCTIONS_OPERATED_WRITES === "0" || env.SANCTIONS_OPERATED_WRITES === "false") {
    ops.setOperatedWritesEnabled(false, "env");
  }
  return ops;
}

export function sanctionsHealthBody(ops: SanctionsOps): SanctionsHealth & { operatorPolicyVersion: string } {
  const h = ops.health();
  return { ...h, operatorPolicyVersion: OPERATOR_POLICY_ID };
}

export function handleSanctionsOpsRequest(
  ops: SanctionsOps,
  req: { method?: string; pathname: string; headers?: HeaderMap; body?: Record<string, unknown>; opsAuthorized?: boolean },
): { status: number; body: Record<string, unknown> } | null {
  const method = (req.method ?? "GET").toUpperCase();
  const path = req.pathname.replace(/\/+$/, "") || "/";

  if (path === "/sanctions/health" && method === "GET") {
    return { status: 200, body: sanctionsHealthBody(ops) };
  }

  if (path === "/ops/sanctions/refresh" && method === "POST") {
    if (!req.opsAuthorized) return { status: 401, body: { error: "ops auth required" } };
    return { status: 202, body: { accepted: true, note: "await refresh() on the caller" } };
  }

  if (path === "/ops/sanctions/writes" && method === "POST") {
    if (!req.opsAuthorized) return { status: 401, body: { error: "ops auth required" } };
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") return { status: 400, body: { error: "enabled boolean required" } };
    const rec = ops.setOperatedWritesEnabled(enabled, String(req.body?.operator ?? "ops"));
    return { status: 200, body: { ok: true, operatedWritesEnabled: ops.operatedWritesEnabled, auditReason: rec.reason } };
  }

  if (path === "/ops/sanctions/review" && method === "POST") {
    if (!req.opsAuthorized) return { status: 401, body: { error: "ops auth required" } };
    const result = ops.requestOverride({
      kind: req.body?.kind === "operator_explicit" ? "operator_explicit" : "user_complaint",
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
      operatorId: typeof req.body?.operatorId === "string" ? req.body.operatorId : undefined,
      wallet: typeof req.body?.wallet === "string" ? req.body.wallet : undefined,
    });
    return { status: result.ok ? 202 : 403, body: { ...result, applied: result.ok ? false : undefined } };
  }

  return null;
}

export { SANCTIONS_REFRESH_INTERVAL_MS, OPERATOR_POLICY_ID };
