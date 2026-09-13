import { containsResidualSecret, redactEvent, redactString, redactUnknown } from "./redact";
import { classifyUrl, isTelemetryKind, maybeSimulation, type FailureKind, type TelemetryKind } from "./kinds";
import { releaseInfo } from "./release";
import { postSentryStore } from "./sentry";
import { shouldPageOperator, type FailureSample } from "./alerts";
import { extractTxHash, newTraceId } from "./correlate";
import { isUserRejection } from "./wallet-errors";

export type TelemetryEvent = {
  type: "exception" | "message";
  kind: TelemetryKind;
  message: string;
  name?: string;
  extra?: Record<string, unknown>;
  release: string;
  protocolVersion: string;
  factoryVersion: number;
  buildSha: string;
  env: string;
  reactorEnv: string;
  chainId: number;
  chainName: string;
  buildTimestamp: string;
  traceId: string;
  page: boolean;
  outageClass?: string | null;
  pagingReason?: string;
  route?: string;
  ts: number;
};

export type TelemetrySink = (event: TelemetryEvent) => void | Promise<void>;

const DEDUPE_MS = 8_000;
const lastSent = new Map<string, number>();
const sinks: TelemetrySink[] = [];
const recentFailures: FailureSample[] = [];

function currentRoute(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.location.pathname;
  } catch {
    return undefined;
  }
}

function rememberFailure(sample: FailureSample): void {
  recentFailures.unshift(sample);
  if (recentFailures.length > 80) recentFailures.length = 80;
}

export function buildTelemetryEvent(
  type: TelemetryEvent["type"],
  kind: TelemetryKind,
  err: unknown,
  extra?: Record<string, unknown>,
): TelemetryEvent {
  const rel = releaseInfo();
  const error = err instanceof Error ? err : new Error(typeof err === "string" ? err : "unknown failure");
  const extraIn = extra ? { ...extra } : {};
  const traceId = typeof extraIn.traceId === "string" && extraIn.traceId ? extraIn.traceId : newTraceId();
  extraIn.traceId = traceId;
  const txHash = extractTxHash(err);
  if (txHash && extraIn.txHash == null) extraIn.txHash = txHash;
  const raw: TelemetryEvent = {
    type,
    kind,
    message: error.message || "unknown failure",
    name: error.name,
    extra: redactUnknown(extraIn) as Record<string, unknown>,
    release: rel.release,
    protocolVersion: rel.protocolVersion,
    factoryVersion: rel.factoryVersion,
    buildSha: rel.buildSha,
    env: rel.env,
    reactorEnv: rel.reactorEnv,
    chainId: rel.chainId,
    chainName: rel.chainName,
    buildTimestamp: rel.buildTimestamp,
    traceId,
    page: extraIn.page === true,
    outageClass: typeof extraIn.outageClass === "string" || extraIn.outageClass === null ? extraIn.outageClass : undefined,
    pagingReason: typeof extraIn.pagingReason === "string" ? extraIn.pagingReason : undefined,
    route: typeof extraIn.route === "string" ? extraIn.route : currentRoute(),
    ts: Date.now(),
  };
  return redactEvent(raw);
}

function dedupeKey(event: TelemetryEvent): string {
  return `${event.kind}:${event.name ?? ""}:${event.message}:${event.route ?? ""}`;
}

function shouldEmit(event: TelemetryEvent, now = Date.now()): boolean {
  const key = dedupeKey(event);
  const prev = lastSent.get(key) ?? 0;
  if (now - prev < DEDUPE_MS) return false;
  lastSent.set(key, now);
  return true;
}

export function addTelemetrySink(sink: TelemetrySink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

export function resetTelemetryForTests(): void {
  lastSent.clear();
  sinks.length = 0;
  recentFailures.length = 0;
}

async function deliver(event: TelemetryEvent): Promise<void> {
  if (containsResidualSecret(event)) {
    const scrubbed: TelemetryEvent = {
      ...event,
      message: "[redacted-residual-secret]",
      extra: { dropped: "residual-secret" },
    };
    await fanout(scrubbed);
    return;
  }
  await fanout(event);
}

async function fanout(event: TelemetryEvent): Promise<void> {
  if (typeof console !== "undefined" && runtimeWantsConsole(event)) {
    console.warn(JSON.stringify({ src: "reactor-web", ...event }));
  }
  for (const sink of sinks) {
    try {
      await sink(event);
    } catch {
      /* sink isolation */
    }
  }
  if (typeof window !== "undefined") {
    void postToBff(event);
  } else {
    void forwardSentry(event);
  }
}

function runtimeWantsConsole(event: TelemetryEvent): boolean {
  if (event.env === "test" || process.env.NODE_ENV === "test") return false;
  return event.kind !== "release" || event.env === "prod" || event.env === "production";
}

async function postToBff(event: TelemetryEvent): Promise<void> {
  const body = JSON.stringify(event);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const queued = navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }));
        if (queued) return;
      } catch {
        /* fall through to fetch */
      }
    }
    const res = await fetch("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
    // 429 is intended ingest backpressure — do not retry onto a public DSN.
    if (res.ok || res.status === 429) return;
  } catch {
    /* BFF down — optional public DSN fallback */
  }
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) {
    try {
      await postSentryStore(dsn, event);
    } catch {
      /* swallow */
    }
  }
}

async function forwardSentry(event: TelemetryEvent): Promise<void> {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    await postSentryStore(dsn, event);
  } catch {
    /* swallow */
  }
}

function reporterPageOverride(extra?: Record<string, unknown>): boolean | undefined {
  if (extra?.page === false) return false;
  if (extra?.page === true) return true;
  return undefined;
}

export function reportFailure(kind: FailureKind, err: unknown, extra?: Record<string, unknown>): TelemetryEvent {
  const resolved = maybeSimulation(kind, err);
  const at = Date.now();
  const sample: FailureSample = { kind: resolved, at, err, page: reporterPageOverride(extra) };
  const decision = shouldPageOperator(sample, recentFailures, at);
  rememberFailure({ ...sample, page: decision.page });
  const event = buildTelemetryEvent("exception", resolved, err, {
    ...extra,
    page: decision.page,
    outageClass: decision.outageClass,
    pagingReason: decision.reason,
    suppressedUserRejection: decision.suppressedUserRejection,
  });
  event.page = decision.page;
  event.outageClass = decision.outageClass;
  event.pagingReason = decision.reason;
  if (!shouldEmit(event)) return event;
  void deliver(event);
  return event;
}

export function captureMessage(kind: TelemetryKind, message: string, extra?: Record<string, unknown>): TelemetryEvent {
  const event = buildTelemetryEvent("message", kind, new Error(redactString(message)), extra);
  if (!shouldEmit(event)) return event;
  void deliver(event);
  return event;
}

export function userVisibleFailure(
  kind: FailureKind,
  err: unknown,
  extra?: Record<string, unknown>,
): { message: string; event: TelemetryEvent } {
  const event = reportFailure(kind, err, extra);
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Request failed";
  return { message, event };
}

let bootReported = false;

export function reportReleaseOnce(): TelemetryEvent | null {
  if (bootReported) return null;
  bootReported = true;
  if (typeof window !== "undefined") {
    try {
      if (window.sessionStorage.getItem("reactor-release-boot") === releaseInfo().release) return null;
      window.sessionStorage.setItem("reactor-release-boot", releaseInfo().release);
    } catch {
      /* private mode */
    }
  }
  return captureMessage("release", "web boot", { source: "build-telemetry" });
}

export function reportReleaseOnceResetForTests(): void {
  bootReported = false;
}

export function classifyFetchFailure(url: string): FailureKind {
  return classifyUrl(url);
}

function numField(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function acceptIngestedEvent(body: unknown): TelemetryEvent | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  if (rec.type !== "exception" && rec.type !== "message") return null;
  if (!isTelemetryKind(rec.kind)) return null;
  if (typeof rec.message !== "string") return null;
  const rel = releaseInfo();
  const raw: TelemetryEvent = {
    type: rec.type,
    kind: rec.kind,
    message: rec.message,
    name: typeof rec.name === "string" ? rec.name : undefined,
    extra: rec.extra && typeof rec.extra === "object" ? (rec.extra as Record<string, unknown>) : undefined,
    release: typeof rec.release === "string" ? rec.release : rel.release,
    protocolVersion: typeof rec.protocolVersion === "string" ? rec.protocolVersion : rel.protocolVersion,
    factoryVersion: numField(rec.factoryVersion, rel.factoryVersion),
    buildSha: typeof rec.buildSha === "string" ? rec.buildSha : rel.buildSha,
    env: typeof rec.env === "string" ? rec.env : rel.env,
    reactorEnv: typeof rec.reactorEnv === "string" ? rec.reactorEnv : rel.reactorEnv,
    chainId: numField(rec.chainId, rel.chainId),
    chainName: typeof rec.chainName === "string" ? rec.chainName : rel.chainName,
    buildTimestamp: typeof rec.buildTimestamp === "string" ? rec.buildTimestamp : rel.buildTimestamp,
    traceId: typeof rec.traceId === "string" ? rec.traceId : newTraceId(),
    page: rec.page === true,
    outageClass: typeof rec.outageClass === "string" ? rec.outageClass : rec.outageClass === null ? null : undefined,
    pagingReason: typeof rec.pagingReason === "string" ? rec.pagingReason : undefined,
    route: typeof rec.route === "string" ? rec.route : undefined,
    ts: typeof rec.ts === "number" ? rec.ts : Date.now(),
  };
  const event = redactEvent(raw);
  if (containsResidualSecret(event)) return null;
  return event;
}

export { classifyUrl, isUserRejection };
