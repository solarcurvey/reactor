import { asRecord } from "./redact";

export function newTraceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 16);
}

/** Truncated tx hash for UI + telemetry. Full 32-byte hex is redacted to the same shape. */
export function extractTxHash(err: unknown): string | undefined {
  const rec = asRecord(err);
  const candidates = [rec?.hash, rec?.transactionHash, rec?.txHash];
  for (const h of candidates) {
    if (typeof h === "string" && /^0x[a-fA-F0-9]{64}$/.test(h)) {
      return `${h.slice(0, 10)}…${h.slice(-6)}`;
    }
  }
  return undefined;
}

export function formatSupportRef(event: {
  traceId?: string;
  chainId: number;
  extra?: Record<string, unknown>;
}): string {
  const extraTid = event.extra && typeof event.extra.traceId === "string" ? event.extra.traceId : "";
  const tid = event.traceId || extraTid;
  const chain = event.chainId;
  const tx = event.extra && typeof event.extra.txHash === "string" ? event.extra.txHash : "";
  const parts = [`ref ${tid || "—"}`, `chain ${chain}`];
  if (tx) parts.push(`tx ${tx}`);
  return parts.join(" · ");
}
