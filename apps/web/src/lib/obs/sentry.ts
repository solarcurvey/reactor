import type { TelemetryEvent } from "./telemetry";

export type ParsedSentryDsn = {
  storeUrl: string;
  envelopeUrl: string;
  publicKey: string;
  projectId: string;
};

/** Parse a Sentry DSN. Invalid / empty DSN is a no-op (local + CI). */
export function parseSentryDsn(dsn: string | undefined | null): ParsedSentryDsn | null {
  if (!dsn || typeof dsn !== "string") return null;
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\//, "").split("/")[0] ?? "";
    if (!publicKey || !projectId || publicKey.length < 8) return null;
    const origin = `${u.protocol}//${u.host}`;
    return {
      publicKey,
      projectId,
      storeUrl: `${origin}/api/${projectId}/store/`,
      envelopeUrl: `${origin}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

export function sentryAuthHeader(publicKey: string, client: string): string {
  return `Sentry sentry_version=7, sentry_client=${client}, sentry_key=${publicKey}`;
}

export type SentryStackFrame = {
  filename: string;
  function?: string;
  lineno: number;
  colno: number;
  in_app: boolean;
};

export type ResolvedFrameHint = {
  fn?: string;
  generated?: string;
  original?: string | null;
};

/** Prefer original (symbolicated) path when present: `obs-probe.ts:2:3`. */
export function sentryFramesFromResolved(hints: unknown): SentryStackFrame[] {
  if (!Array.isArray(hints)) return [];
  const frames: SentryStackFrame[] = [];
  for (const raw of hints) {
    if (!raw || typeof raw !== "object") continue;
    const hint = raw as ResolvedFrameHint;
    const loc = typeof hint.original === "string" && hint.original ? hint.original : hint.generated;
    if (!loc || typeof loc !== "string") continue;
    const m = /^(?<file>.+):(?<line>\d+):(?<col>\d+)$/.exec(loc);
    if (!m?.groups?.file || !m.groups.line || !m.groups.col) continue;
    frames.push({
      filename: m.groups.file,
      function: typeof hint.fn === "string" ? hint.fn : undefined,
      lineno: Number(m.groups.line),
      colno: Number(m.groups.col),
      in_app: true,
    });
  }
  return frames;
}

export function toSentryStorePayload(event: TelemetryEvent): Record<string, unknown> {
  const frames = sentryFramesFromResolved(event.extra?.resolvedFrames);
  const exception =
    event.type === "exception"
      ? {
          values: [
            {
              type: event.name ?? "Error",
              value: event.message,
              ...(frames.length
                ? { stacktrace: { frames } }
                : {}),
            },
          ],
        }
      : undefined;
  return {
    platform: "javascript",
    timestamp: event.ts / 1000,
    release: event.release,
    environment: event.env,
    tags: {
      kind: event.kind,
      protocol: event.protocolVersion,
      build_sha: event.buildSha,
      env: event.env,
      reactor_env: event.reactorEnv,
      chain_id: String(event.chainId),
      chain_name: event.chainName,
      build_time: event.buildTimestamp || "unset",
      page: event.page ? "true" : "false",
      trace_id: event.traceId,
    },
    extra: {
      ...(event.extra ?? {}),
      route: event.route,
      factoryVersion: event.factoryVersion,
      outageClass: event.outageClass,
      pagingReason: event.pagingReason,
    },
    message: event.message,
    exception,
  };
}

export async function postSentryStore(
  dsn: string | undefined | null,
  event: TelemetryEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return false;
  const client = `reactor-web/${event.protocolVersion}`;
  const res = await fetchImpl(parsed.storeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sentry-auth": sentryAuthHeader(parsed.publicKey, client),
    },
    body: JSON.stringify(toSentryStorePayload(event)),
    keepalive: true,
  });
  return res.ok;
}
