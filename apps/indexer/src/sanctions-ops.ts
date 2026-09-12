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
import { OPERATOR_POLICY_ID } from "../../../packages/reactor/src/sanctions-policy.ts";
import { raiseAlert } from "./alerts.ts";
import type { Store } from "./db.ts";
import { logLine } from "./obs.ts";

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

function resolveInject(env: NodeJS.ProcessEnv): FailureInject {
  const raw = (env.SANCTIONS_INJECT ?? "none").toLowerCase();
  if (raw === "stale" || raw === "refresh_fail" || raw === "policy_fail" || raw === "partial_refresh") return raw;
  return "none";
}

function defaultFetcher(env: NodeJS.ProcessEnv): (() => Promise<RefreshPayload>) | undefined {
  if ((env.REACTOR_ENV ?? "").toUpperCase() === "PROD" && env.SANCTIONS_FIXTURE !== "1") {
    return undefined;
  }
  return async () => fixtureRefreshPayload(new Date().toISOString());
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

export function extractWallet(input: { headers: HeaderMap; body?: Record<string, unknown> }): string | undefined {
  const body = input.body ?? {};
  const candidates = [body.wallet, body.creator, body.recipient, body.account, header(input.headers, "x-reactor-wallet")];
  for (const c of candidates) {
    if (typeof c === "string" && /^0x[a-fA-F0-9]{40}$/.test(c.trim())) return c.trim().toLowerCase();
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
