import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { getAddress, parseSignature, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ACTION_SETTLE_QUOTE,
  hashHops,
  jobIdFromOp,
  makeJob,
  settlePayload,
} from "../../../packages/reactor/src/maintenance-job.ts";
import type { UnsignedMaintenanceEnvelope } from "../../../packages/reactor/src/maintenance-envelope.ts";
import { KmsDigestSigner, type DigestSignerBackend } from "./kms-evm.ts";
import {
  assertManagedRelayProductionEnv,
  authorizeMaintenanceEnvelope,
  relayMaintenanceEnvelope,
  type RelayChain,
} from "./managed-relay-core.ts";

const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const local = privateKeyToAccount(PK);
const gateway = "0x1111111111111111111111111111111111111111" as const;
const quote = "0x2222222222222222222222222222222222222222" as const;
const now = 1_800_000_000n;

function spki(): Uint8Array {
  const raw = Buffer.from(local.publicKey.slice(2), "hex");
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "secp256k1",
      x: raw.subarray(1, 33).toString("base64url"),
      y: raw.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  return new Uint8Array(key.export({ format: "der", type: "spki" }) as Buffer);
}
function derInt(v: bigint): Buffer {
  let h = v.toString(16);
  if (h.length % 2) h = `0${h}`;
  let b = Buffer.from(h, "hex");
  if ((b[0]! & 0x80) !== 0) b = Buffer.concat([Buffer.from([0]), b]);
  return Buffer.concat([Buffer.from([2, b.length]), b]);
}
function der(r: bigint, s: bigint): Uint8Array {
  const body = Buffer.concat([derInt(r), derInt(s)]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body]));
}
const backend: DigestSignerBackend = {
  async getPublicKey() { return spki(); },
  async signDigest(digest) {
    const parsed = parseSignature(await local.sign({ hash: digest }));
    return der(BigInt(parsed.r), BigInt(parsed.s));
  },
};
const signer = new KmsDigestSigner(backend);

const hopsHash = hashHops([]);
const unsigned: UnsignedMaintenanceEnvelope = {
  kind: "settleQuote",
  job: makeJob({
    gateway,
    chainId: 1883n,
    action: ACTION_SETTLE_QUOTE,
    payloadHash: settlePayload(quote, 100n, 90n, hopsHash),
    snapshotHash: hopsHash,
    jobId: jobIdFromOp("relay-core-test"),
    nowSec: now,
    ttlSec: 600,
  }),
  quote,
  amount: 100n,
  minOut: 90n,
  hops: [],
};
const signed = await authorizeMaintenanceEnvelope(unsigned, signer, { chainId: 1883n, gateway }, now + 1n);
assert.equal(getAddress(await signer.address()), getAddress(local.address));

function fakeChain(shared = { used: new Set<string>(), tx: 0 }, failSend = false): RelayChain {
  return {
    async nowSec() { return now + 2n; },
    async usedJob(_gateway, jobId) { return shared.used.has(jobId.toLowerCase()); },
    async simulate() {},
    async send() {
      if (failSend) throw new Error("relay unavailable");
      const id = signed.job.jobId.toLowerCase();
      if (shared.used.has(id)) throw new Error("Replay");
      shared.used.add(id);
      shared.tx++;
      return `0x${shared.tx.toString(16).padStart(64, "0")}` as Hex;
    },
    async receipt() { return { status: "success" }; },
  };
}

const sharedRace = { used: new Set<string>(), tx: 0 };
const [raceA, raceB] = await Promise.all([
  relayMaintenanceEnvelope(signed, fakeChain(sharedRace), { chainId: 1883n, gateway, expectedSigner: local.address, relayLabel: "A" }),
  relayMaintenanceEnvelope(signed, fakeChain(sharedRace), { chainId: 1883n, gateway, expectedSigner: local.address, relayLabel: "B" }),
]);
assert.deepEqual(new Set([raceA.status, raceB.status]), new Set(["consumed", "replay"]));
assert.equal(sharedRace.tx, 1, "race must consume exactly one logical job");

const sharedDelay = { used: new Set<string>(), tx: 0 };
const a = await relayMaintenanceEnvelope(signed, fakeChain(sharedDelay), { chainId: 1883n, gateway, expectedSigner: local.address, relayLabel: "A" });
assert.equal(a.status, "consumed");
let slept = 0;
const b = await relayMaintenanceEnvelope(
  signed,
  fakeChain(sharedDelay),
  { chainId: 1883n, gateway, expectedSigner: local.address, relayLabel: "B", delayMs: 15_000 },
  { sleep: async (ms) => { slept = ms; } },
);
assert.equal(slept, 15_000);
assert.equal(b.status, "already-used");
assert.equal(sharedDelay.tx, 1, "delayed B must avoid a second broadcast");

const sharedFailover = { used: new Set<string>(), tx: 0 };
const failedA = await relayMaintenanceEnvelope(signed, fakeChain(sharedFailover, true), { chainId: 1883n, gateway, expectedSigner: local.address, relayLabel: "A" });
assert.equal(failedA.status, "failed");
const goodB = await relayMaintenanceEnvelope(signed, fakeChain(sharedFailover), { chainId: 1883n, gateway, expectedSigner: local.address, relayLabel: "B" });
assert.equal(goodB.status, "consumed");

await assert.rejects(
  () => relayMaintenanceEnvelope({ ...signed, minOut: 89n }, fakeChain(), { chainId: 1883n, gateway, expectedSigner: local.address, relayLabel: "tamper" }),
  /payloadHash mismatch/,
);
await assert.rejects(
  () => relayMaintenanceEnvelope(signed, fakeChain(), { chainId: 5042n, gateway, expectedSigner: local.address, relayLabel: "wrong-chain" }),
  /wrong chain/,
);
await assert.rejects(
  () => relayMaintenanceEnvelope(signed, fakeChain(), { chainId: 1883n, gateway, expectedSigner: "0x3333333333333333333333333333333333333333", relayLabel: "wrong-signer" }),
  /signer mismatch/,
);

assert.throws(
  () => assertManagedRelayProductionEnv({
    REACTOR_ENV: "PROD",
    JOB_SIGNER_PRIVATE_KEY: PK,
    MAINTENANCE_KMS_KEY_ID: "m",
    RELAY_A_KMS_KEY_ID: "a",
    RELAY_B_KMS_KEY_ID: "b",
    MAINTENANCE_GATEWAY_ADDRESS: gateway,
    MAINTENANCE_JOB_SIGNER_ADDRESS: local.address,
  }),
  /forbidden/,
);
assert.throws(
  () => assertManagedRelayProductionEnv({
    REACTOR_ENV: "PROD",
    MAINTENANCE_KMS_KEY_ID: "same",
    RELAY_A_KMS_KEY_ID: "same",
    RELAY_B_KMS_KEY_ID: "b",
    MAINTENANCE_GATEWAY_ADDRESS: gateway,
    MAINTENANCE_JOB_SIGNER_ADDRESS: local.address,
  }),
  /distinct/,
);
assert.doesNotThrow(() => assertManagedRelayProductionEnv({
  REACTOR_ENV: "PROD",
  MAINTENANCE_KMS_KEY_ID: "m",
  RELAY_A_KMS_KEY_ID: "a",
  RELAY_B_KMS_KEY_ID: "b",
  MAINTENANCE_GATEWAY_ADDRESS: gateway,
  MAINTENANCE_JOB_SIGNER_ADDRESS: local.address,
}));

console.log("managed relay core tests: ok");
