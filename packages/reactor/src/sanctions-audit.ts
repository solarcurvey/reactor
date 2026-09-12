/**
 * Policy-decision audit log + redaction (issue #64).
 *
 * Minimizes personal data. Never persist private keys, auth signatures,
 * raw wallet-signing material, full request bodies, or raw IP by default.
 *
 * Not a legal opinion. Not OFAC / sanctions “compliance.”
 */
import { createHash } from "node:crypto";
import { normalizeEvmAddress } from "./sanctions-policy.ts";

export const SANCTIONS_AUDIT_KIND = "sanctions_policy_decision";

export type CoarsePolicyAction =
  | "quote"
  | "launch.admit"
  | "launch.authorize"
  | "launch.sign"
  | "upload"
  | "ops.refresh"
  | "ops.writes"
  | "ops.review";

export type SanctionsAuditRecord = {
  ts: string;
  kind: typeof SANCTIONS_AUDIT_KIND;
  action: CoarsePolicyAction;
  decision: "allow" | "deny" | "unavailable";
  reason: string;
  subject: string | null;
  datasetVersionId: string | null;
  datasetContentHash: string | null;
  geoPolicyVersion: string | null;
  operatorPolicyVersion: string | null;
  requestId?: string;
};

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const IPV6 =
  /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,7}:|:(:[0-9a-f]{1,4}){1,7}\b/gi;
const HEX_KEY = /\b(?:0x)?[a-f0-9]{64}\b/gi;
const SIG_65 = /\b0x[a-f0-9]{130}\b/gi;
const BEARER = /\b(?:bearer|basic)\s+[a-z0-9._\-+/=]+\b/gi;
const JWT = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;
const BIP39_HINT =
  /\b(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident|account|accuse|achieve|acid|acoustic|acquire|across|act|action|actor|actress|actual|adapt|add|addict|address|adjust|admit|adult|advance|advice|aerobic|affair|afford|afraid|again|age|agent|agree|ahead|aim|air|airport|aisle|alarm|album|alcohol|alert|alien|all|alley|allow|almost|alone|alpha|already|also|alter|always|amateur|amazing|among|amount|amused|analyst|anchor|ancient|anger|angle|angry|animal|ankle|announce|annual|another|answer|antenna|antique|anxiety)(?:\s+[a-z]+){10,}\b/gi;

const SENSITIVE_KEYS = new Set([
  "privatekey",
  "private_key",
  "privkey",
  "seed",
  "mnemonic",
  "signature",
  "sig",
  "authorization",
  "auth",
  "bearer",
  "password",
  "secret",
  "ops_token",
  "opstoken",
  "turnstile",
  "cfturnstile",
  "ip",
  "clientip",
  "remoteaddress",
  "xforwardedfor",
  "xrealip",
  "trueclientip",
  "cfconnectingip",
  "body",
  "rawbody",
  "requestbody",
  "payload",
]);

export function hashWallet(address: string | undefined | null): string | null {
  const n = normalizeEvmAddress(address);
  if (!n) return null;
  const digest = createHash("sha256").update(n).digest("hex");
  return `addr:${digest.slice(0, 16)}`;
}

export function redactText(value: string): string {
  return value
    .replace(SIG_65, "[redacted-signature]")
    .replace(JWT, "[redacted-jwt]")
    .replace(BEARER, "[redacted-credential]")
    .replace(HEX_KEY, "[redacted-key]")
    .replace(IPV4, "[redacted-ip]")
    .replace(IPV6, "[redacted-ip]")
    .replace(BIP39_HINT, "[redacted-mnemonic]");
}

function keyName(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const KEEP_HEX_FIELDS = new Set([
  "datasetcontenthash",
  "datasetversionid",
  "contenthash",
  "requestid",
  "operatorpolicyversion",
  "geopolicyversion",
]);

export function redactValue(value: unknown, field?: string): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (field && KEEP_HEX_FIELDS.has(keyName(field))) return value;
    return redactText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, field));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(keyName(k))) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return "[redacted]";
}

export function buildPolicyAudit(input: {
  now?: () => number;
  action: CoarsePolicyAction;
  decision: "allow" | "deny" | "unavailable";
  reason: string;
  wallet?: string | null;
  datasetVersionId?: string | null;
  datasetContentHash?: string | null;
  geoPolicyVersion?: string | null;
  operatorPolicyVersion?: string | null;
  requestId?: string;
}): SanctionsAuditRecord {
  return {
    ts: new Date((input.now ?? Date.now)()).toISOString(),
    kind: SANCTIONS_AUDIT_KIND,
    action: input.action,
    decision: input.decision,
    reason: input.reason,
    subject: hashWallet(input.wallet),
    datasetVersionId: input.datasetVersionId ?? null,
    datasetContentHash: input.datasetContentHash ?? null,
    geoPolicyVersion: input.geoPolicyVersion ?? null,
    operatorPolicyVersion: input.operatorPolicyVersion ?? null,
    requestId: input.requestId,
  };
}

/**
 * Drop fields that must never appear on the audit line, then redact leftovers.
 * Full request bodies and raw IP are stripped even if the caller passed them.
 */
export function sanitizeAuditRecord(record: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    "body",
    "rawBody",
    "requestBody",
    "payload",
    "headers",
    "ip",
    "clientIp",
    "remoteAddress",
    "xForwardedFor",
    "privateKey",
    "signature",
    "authorization",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (blocked.has(k) || SENSITIVE_KEYS.has(keyName(k))) continue;
      out[k] = redactValue(v, k);
  }
  return out;
}

export function formatAuditLine(record: SanctionsAuditRecord): string {
  return JSON.stringify(sanitizeAuditRecord(record as unknown as Record<string, unknown>));
}

export function auditContainsSensitive(line: string, sentinels: string[]): string[] {
  const lower = line.toLowerCase();
  return sentinels.filter((s) => s && lower.includes(s.toLowerCase()));
}
