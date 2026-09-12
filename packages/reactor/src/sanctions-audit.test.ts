import {
  auditContainsSensitive,
  buildPolicyAudit,
  formatAuditLine,
  hashWallet,
  redactText,
  redactValue,
  sanitizeAuditRecord,
} from "./sanctions-audit.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ANVIL0_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const WALLET = "0x1111111111111111111111111111111111111111";
const SIG =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about extra words to trip the bip39 hint";

{
  const hashed = hashWallet(WALLET);
  assert(hashed === hashWallet(`0x${WALLET.slice(2).toUpperCase()}`), "wallet hash is checksum-insensitive");
  assert(hashed !== WALLET.toLowerCase(), "raw wallet is not the subject");
  assert(hashed?.startsWith("addr:"), "subject is a truncated hash");
}

{
  const rec = buildPolicyAudit({
    now: () => Date.parse("2026-09-12T00:00:00.000Z"),
    action: "quote",
    decision: "deny",
    reason: "UNAVAILABLE_DATASET_STALE",
    wallet: WALLET,
    datasetVersionId: "ofac-deadbeefdeadbeef",
    datasetContentHash: "aa".repeat(32),
    geoPolicyVersion: "us-comprehensive-sanctions.r1",
    operatorPolicyVersion: "reactor-operator-policy-v1",
    requestId: "rid-1",
  });
  assert(rec.ts === "2026-09-12T00:00:00.000Z", "timestamp");
  assert(rec.action === "quote", "coarse action");
  assert(rec.reason === "UNAVAILABLE_DATASET_STALE", "reason code");
  assert(rec.subject === hashWallet(WALLET), "hashed subject");
  assert(rec.datasetVersionId === "ofac-deadbeefdeadbeef", "dataset version");
  assert(rec.geoPolicyVersion === "us-comprehensive-sanctions.r1", "geo policy version");
  const line = formatAuditLine(rec);
  assert(!line.includes(WALLET.toLowerCase()), "raw wallet not in audit line");
  assert(line.includes("UNAVAILABLE_DATASET_STALE"), "reason present");
  assert(line.includes("ofac-deadbeefdeadbeef"), "dataset version present");
}

{
  const dirty = {
    ts: "2026-09-12T00:00:00.000Z",
    kind: "sanctions_policy_decision",
    action: "launch.authorize",
    privateKey: ANVIL0_PK,
    signature: SIG,
    authorization: "Bearer super-secret-token",
    ip: "203.0.113.9",
    xForwardedFor: "198.51.100.7, 203.0.113.9",
    body: { wallet: WALLET, turnstile: "0xdead", extra: "full-request" },
    mnemonic: MNEMONIC,
    reason: "ALLOW",
  };
  const clean = sanitizeAuditRecord(dirty);
  const json = JSON.stringify(clean);
  const leaked = auditContainsSensitive(json, [
    ANVIL0_PK,
    ANVIL0_PK.slice(2),
    SIG,
    "super-secret-token",
    "203.0.113.9",
    "198.51.100.7",
    WALLET,
    MNEMONIC,
    "full-request",
  ]);
  assert(leaked.length === 0, `sensitive values leaked: ${leaked.join(",")}`);
  assert(clean.body === undefined, "full body stripped");
  assert(clean.ip === undefined, "raw ip stripped");
  assert(clean.privateKey === undefined, "private key field dropped");
  assert(clean.signature === undefined, "signature field dropped");
}

{
  const text = redactText(`pk=${ANVIL0_PK} sig=${SIG} ip=8.8.8.8 via 2001:db8::1 ${MNEMONIC}`);
  assert(!text.includes(ANVIL0_PK.slice(2)), "key hex redacted");
  assert(!text.includes(SIG), "signature redacted");
  assert(!text.includes("8.8.8.8"), "ipv4 redacted");
  assert(!/2001:db8::1/i.test(text), "ipv6 redacted");
  assert(!text.includes("abandon abandon"), "mnemonic redacted");
}

{
  const nested = redactValue({
    ok: true,
    headers: { "x-forwarded-for": "192.0.2.1", authorization: "Bearer abc.def" },
    note: `wallet ${WALLET} is public but key ${ANVIL0_PK} is not`,
  }) as Record<string, unknown>;
  const headers = nested.headers as Record<string, unknown>;
  assert(headers["x-forwarded-for"] === "[redacted]", "forwarded-for key redacted");
  assert(headers.authorization === "[redacted]", "authorization key redacted");
  assert(!(nested.note as string).includes(ANVIL0_PK.slice(2)), "nested key redacted");
}

console.log("sanctions-audit tests ok");
