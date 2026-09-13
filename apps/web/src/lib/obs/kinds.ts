export const FAILURE_KINDS = [
  "api",
  "rpc",
  "wallet",
  "quote",
  "sse",
  "tx",
  "media",
  "ui",
  "simulation",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export type TelemetryKind = FailureKind | "release" | "perf";

const KIND_SET = new Set<string>([...FAILURE_KINDS, "release", "perf"]);

export function isTelemetryKind(v: unknown): v is TelemetryKind {
  return typeof v === "string" && KIND_SET.has(v);
}

/** Classify an indexer / BFF URL without sending the raw query (may contain secrets). */
export function classifyUrl(url: string): FailureKind {
  const path = url.replace(/^https?:\/\/[^/?#]+/i, "").split("?")[0] ?? "";
  if (/\/quote$/i.test(path) || /\/quote\//i.test(path)) return "quote";
  if (/\/upload\b|\/m\//i.test(path)) return "media";
  if (/\/stream\b/i.test(path)) return "sse";
  return "api";
}

export function safePath(url: string): string {
  try {
    const u = new URL(url, "http://reactor.invalid");
    return u.pathname || "/";
  } catch {
    return url.replace(/\?.*$/, "").replace(/^https?:\/\/[^/]+/i, "") || "/";
  }
}

const SIM_RE = /simulat|eth_call|execution reverted|preview (failed|reverted)|call exception/i;

/** Quote / RPC / tx text that is a preview or eth_call revert is the simulation outage class. */
export function maybeSimulation(kind: FailureKind, err: unknown): FailureKind {
  if (kind !== "quote" && kind !== "rpc" && kind !== "tx") return kind;
  const rec = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const msg = String(rec?.shortMessage ?? rec?.message ?? err ?? "");
  return SIM_RE.test(msg) ? "simulation" : kind;
}
