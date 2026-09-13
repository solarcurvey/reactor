/**
 * Official-list freshness SLA, last-known-good refresh, health, and alerts
 * (issue #64). Aligns with #61 persist layout and #62 reason codes.
 *
 * Engineering risk-reduction only. Not legal / OFAC “compliance.”
 * Protected writes must not treat stale or unknown data as clear.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  OPERATOR_POLICY_ID,
  evaluateOperatorPolicy,
  normalizeEvmAddress,
  publicPolicyBody,
  type AddressScreenResult,
  type GeoPolicyResult,
  type OperatorPolicyDecision,
} from "./sanctions-policy.ts";
import {
  type CoarsePolicyAction,
  type SanctionsAuditRecord,
  buildPolicyAudit,
  formatAuditLine,
} from "./sanctions-audit.ts";

export const SANCTIONS_OPS_DISCLAIMER =
  "REACTOR-operated screening freshness and policy ops only. Not legal or OFAC compliance. Public contracts remain callable onchain.";

/** Explicit official-list freshness SLA (same default as #61 `DEFAULT_MAX_AGE_MS`). */
export const SANCTIONS_DATASET_SLA_MS = 7 * 24 * 60 * 60 * 1000;
export const SANCTIONS_DATASET_SLA_ID = "ofac-official-list-v1";
export const SANCTIONS_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SANCTIONS_REFRESH_FAILURE_ALERT_THRESHOLD = 3;
export const SANCTIONS_COMPLETENESS_RATIO = 0.85;
export const SANCTIONS_SOURCE_BYTES_RATIO = 0.5;
export const GEO_POLICY_VERSION_DEFAULT = "us-comprehensive-sanctions.r1";
export const PARSER_VERSION = "1.0.0";

export const ALERT_STALE_DATASET = "sanctions_dataset_stale";
export const ALERT_REFRESH_FAILED = "sanctions_refresh_failed";
export const ALERT_POLICY_FAILED = "sanctions_policy_unavailable";

export type DatasetFreshness = "current" | "stale" | "missing";

export type OfficialAddress = {
  family: string;
  canonicalKey: string;
  display?: string;
};

export type SourceFetchMeta = {
  id: string;
  url: string;
  format: string;
  retrievedAt: string;
  contentHash: string;
  byteLength: number;
  httpStatus: number;
  etag?: string;
  lastModified?: string;
  publishDate?: string;
  recordCount?: number;
};

export type DatasetVersion = {
  id: string;
  retrievedAt: string;
  activatedAt?: string;
  lastSuccessfulRefreshAt?: string;
  sources: SourceFetchMeta[];
  contentHash: string;
  /** Retrieval/source-generation identity. Same addresses, new fetch → new id. */
  sourceGenerationHash: string;
  parserVersion: string;
  addressCount: number;
  slaId: typeof SANCTIONS_DATASET_SLA_ID;
  slaMs: number;
};

export type DatasetSnapshot = {
  version: DatasetVersion;
  addresses: OfficialAddress[];
};

export type RefreshState = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastDegradedAt: string | null;
};

export type RefreshPayload = {
  sources: SourceFetchMeta[];
  addresses: OfficialAddress[];
  retrievedAt: string;
  warningCount?: number;
  /** Official #61 version id. Preserved when adapting; never recomputed from addresses only. */
  officialVersionId?: string;
  /** Official #61 source-generation hash. Preserved when adapting. */
  officialSourceGenerationHash?: string;
};

export type ActivateResult =
  | { ok: true; snapshot: DatasetSnapshot }
  | { ok: false; error: string; preserved: DatasetSnapshot | null };

export type RefreshResult =
  | { ok: true; version: DatasetVersion }
  | { ok: false; error: string; preservedVersion: DatasetVersion | null };

export type SanctionsAlert = {
  level: "P1" | "warn";
  code: typeof ALERT_STALE_DATASET | typeof ALERT_REFRESH_FAILED | typeof ALERT_POLICY_FAILED;
  detail: string;
};

export type SanctionsHealth = {
  ok: boolean;
  degraded: boolean;
  slaId: typeof SANCTIONS_DATASET_SLA_ID;
  slaMs: number;
  freshness: DatasetFreshness;
  dataset: {
    versionId: string | null;
    contentHash: string | null;
    retrievedAt: string | null;
    activatedAt: string | null;
    lastSuccessfulRefreshAt: string | null;
    ageMs: number | null;
    addressCount: number;
    sources: SourceFetchMeta[];
  };
  policy: {
    operatorPolicyVersion: string;
    geoPolicyVersion: string;
    operatedWritesEnabled: boolean;
  };
  refresh: RefreshState;
  alerts: SanctionsAlert[];
  disclaimer: typeof SANCTIONS_OPS_DISCLAIMER;
};

export type FailureInject = "none" | "stale" | "refresh_fail" | "policy_fail" | "partial_refresh";

export type OverrideKind = "user_complaint" | "operator_explicit";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function datasetContentHash(addresses: OfficialAddress[]): string {
  const keys = [...addresses.map((a) => a.canonicalKey)].sort();
  return sha256Hex(keys.join("\n"));
}

/** Hash of retrieval + per-source publication/HTTP metadata. Same addresses, new fetch → new generation. */
export function sourceGenerationHash(sources: SourceFetchMeta[], retrievedAt: string): string {
  const rows = [...sources]
    .map((s) => ({
      id: s.id,
      url: s.url,
      retrievedAt: s.retrievedAt,
      contentHash: s.contentHash,
      etag: s.etag ?? "",
      lastModified: s.lastModified ?? "",
      publishDate: s.publishDate ?? "",
      byteLength: s.byteLength,
      recordCount: s.recordCount ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return sha256Hex(JSON.stringify({ retrievedAt, sources: rows }));
}

/** Same shape as #61 `datasetVersionId`. Content hash alone is not a generation. */
export function datasetVersionId(contentHash: string, generationHash: string): string {
  return `ofac-${contentHash.slice(0, 16)}-${generationHash.slice(0, 12)}`;
}

export type OfficialActiveSnapshot = {
  version: {
    id?: string;
    retrievedAt: string;
    sources: SourceFetchMeta[];
    contentHash?: string;
    sourceGenerationHash?: string;
    addressCount?: number;
  };
  index: Iterable<{ family: string; canonicalKey: string; display?: string }>;
};

/**
 * Adapt an official #61 store snapshot into a #64 refresh payload.
 * Preserves retrievedAt, sources, and generation identity — does not collapse to address-only id.
 */
export function adaptOfficialRefreshPayload(active: OfficialActiveSnapshot): RefreshPayload {
  return {
    retrievedAt: active.version.retrievedAt,
    sources: active.version.sources,
    addresses: [...active.index].map((a) => ({
      family: a.family,
      canonicalKey: a.canonicalKey,
      display: a.display,
    })),
    officialVersionId: active.version.id,
    officialSourceGenerationHash: active.version.sourceGenerationHash,
  };
}

function writeAtomic(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function assessDatasetFreshness(
  retrievedAt: string | null | undefined,
  opts: { maxAgeMs?: number; now?: () => number } = {},
): DatasetFreshness {
  if (!retrievedAt) return "missing";
  const retrieved = Date.parse(retrievedAt);
  if (!Number.isFinite(retrieved)) return "stale";
  const now = (opts.now ?? Date.now)();
  const maxAge = opts.maxAgeMs ?? SANCTIONS_DATASET_SLA_MS;
  return now - retrieved > maxAge ? "stale" : "current";
}

export function completenessError(
  input: RefreshPayload,
  prior: DatasetSnapshot | null,
  opts: { allowCatastrophicShrink?: boolean } = {},
): string | null {
  if (input.addresses.length < 1) return `replacement has ${input.addresses.length} addresses; need ≥ 1`;
  if (input.sources.length < 1) return "replacement omitted every official source";
  if (!prior || prior.version.addressCount <= 0 || opts.allowCatastrophicShrink) return null;

  const floor = Math.ceil(prior.version.addressCount * SANCTIONS_COMPLETENESS_RATIO);
  if (input.addresses.length < floor) {
    return `replacement has ${input.addresses.length} addresses; last-known-good has ${prior.version.addressCount} (floor ${floor})`;
  }

  const priorById = new Map(prior.version.sources.map((s) => [s.id, s]));
  const nextById = new Map(input.sources.map((s) => [s.id, s]));
  for (const [id, prev] of priorById) {
    const next = nextById.get(id);
    if (!next) return `replacement omitted source ${id} that last-known-good included`;
    if (prev.byteLength > 0) {
      const byteFloor = Math.ceil(prev.byteLength * SANCTIONS_SOURCE_BYTES_RATIO);
      if (next.byteLength < byteFloor) {
        return `source ${id} body shrank from ${prev.byteLength} to ${next.byteLength} bytes (floor ${byteFloor})`;
      }
    }
  }
  return null;
}

export function evaluateSanctionsAlerts(health: Pick<SanctionsHealth, "freshness" | "refresh" | "ok"> & {
  policyFailure?: boolean;
}): SanctionsAlert[] {
  const alerts: SanctionsAlert[] = [];
  if (health.freshness === "stale" || health.freshness === "missing") {
    alerts.push({
      level: "P1",
      code: ALERT_STALE_DATASET,
      detail: `official-list freshness=${health.freshness}; SLA ${SANCTIONS_DATASET_SLA_ID}`,
    });
  }
  if (health.refresh.consecutiveFailures >= SANCTIONS_REFRESH_FAILURE_ALERT_THRESHOLD) {
    alerts.push({
      level: "P1",
      code: ALERT_REFRESH_FAILED,
      detail: `consecutive refresh failures=${health.refresh.consecutiveFailures}; last=${health.refresh.lastError ?? "unknown"}`,
    });
  }
  if (health.policyFailure) {
    alerts.push({
      level: "P1",
      code: ALERT_POLICY_FAILED,
      detail: "operator policy evaluation failed closed",
    });
  }
  return alerts;
}

export function reviewOverride(input: {
  kind: OverrideKind;
  reason?: string;
  operatorId?: string;
}): { ok: false; error: string } | { ok: true; applied: false; queued: true } {
  if (input.kind === "user_complaint") {
    return { ok: false, error: "NO_AUTOMATED_OVERRIDE" };
  }
  if (input.kind !== "operator_explicit" || !input.operatorId?.trim() || !input.reason?.trim()) {
    return { ok: false, error: "OVERRIDE_REQUIRES_EXPLICIT_OPERATOR" };
  }
  // Explicit review ticket only — never delists or flips a deny to allow.
  return { ok: true, applied: false, queued: true };
}

export class OfficialListRegistry {
  readonly dataDir: string;
  readonly maxAgeMs: number;
  readonly now: () => number;
  private current: DatasetSnapshot | null = null;
  private refresh: RefreshState = {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastDegradedAt: null,
  };

  constructor(opts: { dataDir: string; maxAgeMs?: number; now?: () => number }) {
    this.dataDir = opts.dataDir;
    this.maxAgeMs = opts.maxAgeMs ?? SANCTIONS_DATASET_SLA_MS;
    this.now = opts.now ?? Date.now;
    mkdirSync(this.dataDir, { recursive: true });
  }

  active(): DatasetSnapshot | null {
    return this.current;
  }

  refreshState(): RefreshState {
    return { ...this.refresh };
  }

  loadFromDisk(): DatasetSnapshot | null {
    const persistedRefresh = readJson<RefreshState>(join(this.dataDir, "refresh-state.json"));
    if (persistedRefresh) this.refresh = persistedRefresh;
    const pointer = readJson<{
      versionId?: string;
      retrievedAt?: string;
      sourceGenerationHash?: string;
      activatedAt?: string;
      lastSuccessfulRefreshAt?: string;
    }>(join(this.dataDir, "current.json"));
    if (!pointer?.versionId) {
      this.current = null;
      return null;
    }
    const file = join(this.dataDir, "versions", pointer.versionId, "dataset.json");
    const data = readJson<{ version: DatasetVersion; addresses: OfficialAddress[] }>(file);
    if (!data?.version?.id || !Array.isArray(data.addresses)) {
      this.current = null;
      return null;
    }
    if (pointer.retrievedAt) data.version.retrievedAt = pointer.retrievedAt;
    if (pointer.sourceGenerationHash) data.version.sourceGenerationHash = pointer.sourceGenerationHash;
    if (pointer.activatedAt) data.version.activatedAt = pointer.activatedAt;
    if (pointer.lastSuccessfulRefreshAt) data.version.lastSuccessfulRefreshAt = pointer.lastSuccessfulRefreshAt;
    if (!data.version.sourceGenerationHash) {
      data.version.sourceGenerationHash = sourceGenerationHash(data.version.sources ?? [], data.version.retrievedAt);
    }
    this.current = { version: data.version, addresses: data.addresses };
    return this.current;
  }

  /**
   * Persist a complete replacement, then atomically swing `current.json`.
   * Any validation or I/O failure leaves last-known-good untouched.
   */
  activate(input: RefreshPayload, opts: { allowCatastrophicShrink?: boolean } = {}): ActivateResult {
    const prior = this.current ?? this.loadFromDisk();
    const err = completenessError(input, prior, opts);
    if (err) return { ok: false, error: err, preserved: prior };

    const contentHash = datasetContentHash(input.addresses);
    const generationHash = input.officialSourceGenerationHash ?? sourceGenerationHash(input.sources, input.retrievedAt);
    const version: DatasetVersion = {
      id: input.officialVersionId ?? datasetVersionId(contentHash, generationHash),
      retrievedAt: input.retrievedAt,
      sources: input.sources,
      contentHash,
      sourceGenerationHash: generationHash,
      parserVersion: PARSER_VERSION,
      addressCount: input.addresses.length,
      slaId: SANCTIONS_DATASET_SLA_ID,
      slaMs: this.maxAgeMs,
    };

    const tmpRoot = join(this.dataDir, "tmp", randomBytes(8).toString("hex"));
    const dest = join(this.dataDir, "versions", version.id);
    try {
      mkdirSync(tmpRoot, { recursive: true });
      const persisted = { version, addresses: input.addresses };
      writeFileSync(join(tmpRoot, "dataset.json"), JSON.stringify(persisted), "utf8");
      writeFileSync(join(tmpRoot, "version.json"), JSON.stringify(version, null, 2), "utf8");
      const reload = JSON.parse(readFileSync(join(tmpRoot, "dataset.json"), "utf8")) as typeof persisted;
      if (reload.addresses.length !== input.addresses.length || reload.version.contentHash !== contentHash) {
        throw new Error("persisted dataset failed round-trip validation");
      }
      if (reload.version.retrievedAt !== input.retrievedAt || reload.version.sourceGenerationHash !== generationHash) {
        throw new Error("persisted generation metadata failed round-trip validation");
      }
      mkdirSync(dirname(dest), { recursive: true });
      if (existsSync(dest)) {
        const existing = readJson<{ version?: DatasetVersion }>(join(dest, "dataset.json"));
        if (
          existing?.version?.sourceGenerationHash !== generationHash ||
          existing?.version?.retrievedAt !== input.retrievedAt
        ) {
          throw new Error("version id collision with different retrieval metadata");
        }
        rmSync(tmpRoot, { recursive: true, force: true });
      } else {
        renameSync(tmpRoot, dest);
      }
      const activatedAt = new Date(this.now()).toISOString();
      writeAtomic(
        join(this.dataDir, "current.json"),
        JSON.stringify({
          versionId: version.id,
          retrievedAt: input.retrievedAt,
          sourceGenerationHash: generationHash,
          activatedAt,
          lastSuccessfulRefreshAt: activatedAt,
        }),
      );
      version.activatedAt = activatedAt;
      version.lastSuccessfulRefreshAt = activatedAt;
      const snapshot = { version, addresses: input.addresses };
      this.current = snapshot;
      this.recordRefreshSuccess(activatedAt);
      return { ok: true, snapshot };
    } catch (e) {
      rmSync(tmpRoot, { recursive: true, force: true });
      this.current = prior;
      return { ok: false, error: e instanceof Error ? e.message : String(e), preserved: prior };
    }
  }

  recordRefreshAttempt() {
    this.refresh.lastAttemptAt = new Date(this.now()).toISOString();
    this.persistRefresh();
  }

  recordRefreshSuccess(at: string) {
    this.refresh.lastAttemptAt = at;
    this.refresh.lastSuccessAt = at;
    this.refresh.lastError = null;
    this.refresh.consecutiveFailures = 0;
    this.refresh.lastDegradedAt = null;
    this.persistRefresh();
  }

  recordRefreshFailure(error: string) {
    this.refresh.lastAttemptAt = new Date(this.now()).toISOString();
    this.refresh.lastError = error;
    this.refresh.consecutiveFailures += 1;
    this.refresh.lastDegradedAt = this.refresh.lastAttemptAt;
    this.persistRefresh();
  }

  private persistRefresh() {
    writeAtomic(join(this.dataDir, "refresh-state.json"), JSON.stringify(this.refresh, null, 2));
  }

  freshness(): DatasetFreshness {
    return assessDatasetFreshness(this.current?.version.retrievedAt, { maxAgeMs: this.maxAgeMs, now: this.now });
  }

  screenAddress(address: string, blocked: Set<string> = new Set()): AddressScreenResult {
    const freshness = this.freshness();
    if (!this.current) return { decision: "unavailable", reason: "missing_dataset", freshness: "missing" };
    const n = normalizeEvmAddress(address);
    if (!n) return { decision: "unavailable", reason: "invalid_query", freshness };
    const key = `evm:${n}`;
    const listed = this.current.addresses.some((a) => a.canonicalKey === key) || blocked.has(n);
    if (listed) return { decision: "blocked", freshness };
    if (freshness === "stale") return { decision: "unavailable", reason: "stale_dataset", freshness: "stale" };
    return { decision: "clear", freshness: "current" };
  }
}

export type SanctionsOpsOpts = {
  dataDir: string;
  maxAgeMs?: number;
  now?: () => number;
  geoPolicyVersion?: string;
  fetchOfficialList?: () => Promise<RefreshPayload>;
  evaluateGeo?: (headers: Record<string, string | string[] | undefined>) => GeoPolicyResult;
  inject?: FailureInject;
  log?: (line: string) => void;
  raiseAlert?: (alert: SanctionsAlert) => void | Promise<void>;
};

export class SanctionsOps {
  readonly registry: OfficialListRegistry;
  readonly geoPolicyVersion: string;
  operatedWritesEnabled = true;
  private fetchOfficialList?: () => Promise<RefreshPayload>;
  private evaluateGeo: (headers: Record<string, string | string[] | undefined>) => GeoPolicyResult;
  private inject: FailureInject;
  private log: (line: string) => void;
  private raise: (alert: SanctionsAlert) => void | Promise<void>;
  private lastAlerts = new Set<string>();
  readonly now: () => number;

  constructor(opts: SanctionsOpsOpts) {
    this.registry = new OfficialListRegistry({
      dataDir: opts.dataDir,
      maxAgeMs: opts.maxAgeMs,
      now: opts.now,
    });
    this.registry.loadFromDisk();
    this.geoPolicyVersion = opts.geoPolicyVersion ?? GEO_POLICY_VERSION_DEFAULT;
    this.fetchOfficialList = opts.fetchOfficialList;
    this.evaluateGeo =
      opts.evaluateGeo ??
      (() => ({ decision: "ALLOW", reason: "ALLOW_JURISDICTION_NOT_LISTED" }) satisfies GeoPolicyResult);
    this.inject = opts.inject ?? "none";
    this.log = opts.log ?? ((line) => console.log(line));
    this.raise = opts.raiseAlert ?? (() => undefined);
    this.now = opts.now ?? Date.now;
  }

  setInject(value: FailureInject) {
    this.inject = value;
  }

  setFetcher(fn: (() => Promise<RefreshPayload>) | undefined) {
    this.fetchOfficialList = fn;
  }

  health(): SanctionsHealth {
    const active = this.registry.active();
    const freshness =
      this.inject === "stale" && active
        ? "stale"
        : this.registry.freshness();
    const retrievedAt = active?.version.retrievedAt ?? null;
    const ageMs = retrievedAt && Number.isFinite(Date.parse(retrievedAt)) ? this.now() - Date.parse(retrievedAt) : null;
    const policyFailure = this.inject === "policy_fail";
    const refresh = this.registry.refreshState();
    const alerts = evaluateSanctionsAlerts({ freshness, refresh, ok: freshness === "current" && !policyFailure, policyFailure });
    const degraded = freshness !== "current" || refresh.consecutiveFailures > 0 || policyFailure || !this.operatedWritesEnabled;
    return {
      ok: freshness === "current" && refresh.consecutiveFailures === 0 && !policyFailure && this.operatedWritesEnabled,
      degraded,
      slaId: SANCTIONS_DATASET_SLA_ID,
      slaMs: this.registry.maxAgeMs,
      freshness,
      dataset: {
        versionId: active?.version.id ?? null,
        contentHash: active?.version.contentHash ?? null,
        retrievedAt,
        activatedAt: active?.version.activatedAt ?? null,
        lastSuccessfulRefreshAt: refresh.lastSuccessAt ?? active?.version.lastSuccessfulRefreshAt ?? null,
        ageMs,
        addressCount: active?.version.addressCount ?? 0,
        sources: active?.version.sources ?? [],
      },
      policy: {
        operatorPolicyVersion: OPERATOR_POLICY_ID,
        geoPolicyVersion: this.geoPolicyVersion,
        operatedWritesEnabled: this.operatedWritesEnabled,
      },
      refresh,
      alerts,
      disclaimer: SANCTIONS_OPS_DISCLAIMER,
    };
  }

  async emitHealthAlerts(): Promise<SanctionsAlert[]> {
    const alerts = this.health().alerts;
    for (const a of alerts) {
      const key = `${a.code}:${a.detail}`;
      if (this.lastAlerts.has(key)) continue;
      this.lastAlerts.add(key);
      await this.raise(a);
    }
    if (alerts.length === 0) this.lastAlerts.clear();
    return alerts;
  }

  async refresh(): Promise<RefreshResult> {
    this.registry.recordRefreshAttempt();
    const prior = this.registry.active();
    try {
      if (this.inject === "refresh_fail") throw new Error("injected refresh failure");
      if (!this.fetchOfficialList) throw new Error("official-list fetcher is not configured");
      const payload = await this.fetchOfficialList();
      if (this.inject === "partial_refresh") {
        const gutted: RefreshPayload = {
          ...payload,
          addresses: payload.addresses.slice(0, Math.max(0, Math.floor(payload.addresses.length * 0.1))),
          sources: payload.sources.map((s) => ({ ...s, byteLength: Math.max(1, Math.floor(s.byteLength * 0.1)) })),
        };
        const activated = this.registry.activate(gutted);
        if (!activated.ok) {
          this.registry.recordRefreshFailure(activated.error);
          await this.emitHealthAlerts();
          return { ok: false, error: activated.error, preservedVersion: activated.preserved?.version ?? prior?.version ?? null };
        }
      }
      if (!payload.sources.length || payload.sources.some((s) => s.httpStatus >= 400 || s.byteLength < 1)) {
        throw new Error("partial official-list fetch");
      }
      const activated = this.registry.activate(payload);
      if (!activated.ok) {
        this.registry.recordRefreshFailure(activated.error);
        await this.emitHealthAlerts();
        return { ok: false, error: activated.error, preservedVersion: activated.preserved?.version ?? prior?.version ?? null };
      }
      await this.emitHealthAlerts();
      return { ok: true, version: activated.snapshot.version };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.registry.recordRefreshFailure(error);
      await this.emitHealthAlerts();
      return { ok: false, error, preservedVersion: prior?.version ?? this.registry.active()?.version ?? null };
    }
  }

  async startup(): Promise<{ refresh: RefreshResult | null; health: SanctionsHealth }> {
    this.registry.loadFromDisk();
    const before = this.health();
    let refresh: RefreshResult | null = null;
    if (this.fetchOfficialList) {
      refresh = await this.refresh();
    } else if (before.freshness !== "current") {
      await this.emitHealthAlerts();
    }
    return { refresh, health: this.health() };
  }

  setOperatedWritesEnabled(enabled: boolean, actor: string): SanctionsAuditRecord {
    this.operatedWritesEnabled = enabled;
    const rec = buildPolicyAudit({
      now: this.now,
      action: "ops.writes",
      decision: "unavailable",
      reason: enabled ? "OPERATED_WRITES_ENABLED" : "OPERATED_WRITES_DISABLED",
      operatorPolicyVersion: OPERATOR_POLICY_ID,
      geoPolicyVersion: this.geoPolicyVersion,
      datasetVersionId: this.registry.active()?.version.id,
      datasetContentHash: this.registry.active()?.version.contentHash,
    });
    this.log(formatAuditLine({ ...rec, actor: hashActor(actor) } as unknown as SanctionsAuditRecord));
    return rec;
  }

  requestOverride(input: { kind: OverrideKind; reason?: string; operatorId?: string; wallet?: string }) {
    const result = reviewOverride(input);
    const rec = buildPolicyAudit({
      now: this.now,
      action: "ops.review",
      decision: "unavailable",
      reason: result.ok ? "MANUAL_REVIEW_QUEUED" : result.error,
      wallet: input.wallet,
      operatorPolicyVersion: OPERATOR_POLICY_ID,
      geoPolicyVersion: this.geoPolicyVersion,
      datasetVersionId: this.registry.active()?.version.id,
      datasetContentHash: this.registry.active()?.version.contentHash,
    });
    this.log(formatAuditLine(rec));
    return result;
  }

  gateProtectedWrite(input: {
    action: CoarsePolicyAction;
    /** EIP-191 recovered subject from #62. Never a browser-claimed wallet. */
    recoveredWallet?: string | null;
    headers?: Record<string, string | string[] | undefined>;
    body?: Record<string, unknown>;
    requestId?: string;
    blockedWallets?: Set<string>;
  }): {
    ok: boolean;
    status: 200 | 403 | 503;
    decision: OperatorPolicyDecision | { decision: "unavailable"; reason: "OPERATED_WRITES_DISABLED"; httpStatus: 503 };
    body?: Record<string, unknown>;
    audit: SanctionsAuditRecord;
    ranDownstream: boolean;
    ignored: string[];
  } {
    const health = this.health();
    const { subject: wallet, ignored } = resolveGatedSubject({
      recoveredWallet: input.recoveredWallet,
      headers: input.headers,
      body: input.body,
    });
    let decision: OperatorPolicyDecision;
    if (!this.operatedWritesEnabled) {
      const audit = this.auditDecision({
        action: input.action,
        decision: "unavailable",
        reason: "OPERATED_WRITES_DISABLED",
        wallet,
        requestId: input.requestId,
        health,
      });
      return {
        ok: false,
        status: 503,
        decision: { decision: "unavailable", reason: "OPERATED_WRITES_DISABLED", httpStatus: 503 },
        body: {
          ok: false,
          error: "REACTOR-operated write assistance is disabled.",
          reason: "OPERATED_WRITES_DISABLED",
          decision: "unavailable",
          policy: OPERATOR_POLICY_ID,
          disclaimer: SANCTIONS_OPS_DISCLAIMER,
          surface: input.action,
        },
        audit,
        ranDownstream: false,
        ignored,
      };
    }

    if (this.inject === "policy_fail") {
      decision = evaluateOperatorPolicy({
        addressScreen: { decision: "unavailable", reason: "missing_dataset", freshness: "missing" },
        geo: { decision: "UNKNOWN", reason: "UNKNOWN_POLICY_INACTIVE" },
      });
    } else {
      const addressScreen: AddressScreenResult = wallet
        ? this.registry.screenAddress(wallet, input.blockedWallets)
        : { decision: "unavailable", reason: "wallet_missing", freshness: health.freshness === "missing" ? "missing" : "stale" };
      if (health.freshness === "stale" && addressScreen.decision !== "blocked") {
        addressScreen.decision = "unavailable";
        addressScreen.reason = "stale_dataset";
        addressScreen.freshness = "stale";
      }
      if (health.freshness === "missing" && addressScreen.decision !== "blocked") {
        addressScreen.decision = "unavailable";
        addressScreen.reason = "missing_dataset";
        addressScreen.freshness = "missing";
      }
      const geo = this.evaluateGeo(input.headers ?? {});
      decision = evaluateOperatorPolicy({ addressScreen, geo });
    }

    const audit = this.auditDecision({
      action: input.action,
      decision: decision.decision,
      reason: decision.reason,
      wallet,
      requestId: input.requestId,
      health,
    });
    if (decision.decision === "allow") {
      return { ok: true, status: 200, decision, audit, ranDownstream: true, ignored };
    }
    return {
      ok: false,
      status: decision.httpStatus === 403 ? 403 : 503,
      decision,
      body: publicPolicyBody(decision, {
        surface: input.action,
        datasetVersionId: health.dataset.versionId,
        operatorPolicyVersion: health.policy.operatorPolicyVersion,
        geoPolicyVersion: health.policy.geoPolicyVersion,
      }),
      audit,
      ranDownstream: false,
      ignored,
    };
  }

  private auditDecision(input: {
    action: CoarsePolicyAction;
    decision: "allow" | "deny" | "unavailable";
    reason: string;
    wallet?: string | null;
    requestId?: string;
    health: SanctionsHealth;
  }): SanctionsAuditRecord {
    const rec = buildPolicyAudit({
      now: this.now,
      action: input.action,
      decision: input.decision,
      reason: input.reason,
      wallet: input.wallet,
      datasetVersionId: input.health.dataset.versionId,
      datasetContentHash: input.health.dataset.contentHash,
      geoPolicyVersion: input.health.policy.geoPolicyVersion,
      operatorPolicyVersion: input.health.policy.operatorPolicyVersion,
      requestId: input.requestId,
    });
    this.log(formatAuditLine(rec));
    return rec;
  }
}

function hashActor(actor: string): string {
  return `op:${createHash("sha256").update(actor.trim().toLowerCase()).digest("hex").slice(0, 12)}`;
}

/** Browser-claimable fields. Never the screened / audited subject (#62 recovered proof). */
export const CLAIMED_WALLET_BODY_KEYS = ["wallet", "creator", "recipient", "account"] as const;
export const CLAIMED_WALLET_HEADERS = ["x-reactor-wallet"] as const;

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return v == null ? "" : String(v).trim();
}

export function claimedWalletSignals(
  headers: Record<string, string | string[] | undefined> = {},
  body?: Record<string, unknown>,
): string[] {
  const ignored: string[] = [];
  for (const name of CLAIMED_WALLET_HEADERS) {
    if (headerValue(headers, name)) ignored.push(name);
  }
  if (body) {
    for (const key of CLAIMED_WALLET_BODY_KEYS) {
      if (body[key] !== undefined) ignored.push(`body.${key}`);
    }
  }
  return ignored;
}

/**
 * Canonical subject is the #62 recovered signer only.
 * Claimed body/header wallets are recorded as ignored and never become identity.
 */
export function resolveGatedSubject(input: {
  recoveredWallet?: string | null;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
}): { subject?: string; ignored: string[] } {
  return {
    subject: normalizeEvmAddress(input.recoveredWallet ?? undefined),
    ignored: claimedWalletSignals(input.headers, input.body),
  };
}

export function fixtureRefreshPayload(nowIso: string, n = 8, byteLength = 10_000): RefreshPayload {
  const addresses: OfficialAddress[] = [];
  for (let i = 0; i < n; i++) {
    const hex = i.toString(16).padStart(40, "a");
    addresses.push({ family: "evm", canonicalKey: `evm:0x${hex}`, display: `0x${hex}` });
  }
  return {
    retrievedAt: nowIso,
    addresses,
    sources: [
      {
        id: "ofac-sdn-xml",
        url: "https://www.treasury.gov/ofac/downloads/sdn.xml",
        format: "sdn_xml",
        retrievedAt: nowIso,
        contentHash: sha256Hex("fixture-sdn"),
        byteLength,
        httpStatus: 200,
        publishDate: "09/12/2026",
      },
      {
        id: "ofac-consolidated-xml",
        url: "https://www.treasury.gov/ofac/downloads/consolidated.xml",
        format: "consolidated_xml",
        retrievedAt: nowIso,
        contentHash: sha256Hex("fixture-cons"),
        byteLength,
        httpStatus: 200,
        publishDate: "09/12/2026",
      },
    ],
  };
}
