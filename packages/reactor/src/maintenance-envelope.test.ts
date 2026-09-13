import assert from "node:assert/strict";
import {
  ACTION_BUYBACK,
  ACTION_ROLL_EPOCH,
  ACTION_SELF_BURN,
  ACTION_SETTLE_QUOTE,
  ACTION_SUBMIT_EPOCH,
  ACTION_TOP10_BUYBACK,
  buybackPayload,
  epochSnapshotHash,
  hashHops,
  jobIdFromOp,
  makeJob,
  rollPayload,
  selfBurnPayload,
  settlePayload,
  top10Payload,
} from "./maintenance-job.ts";
import {
  ZERO32,
  assertMaintenanceEnvelope,
  encodeRelayCalldata,
  maintenanceEnvelopeFromJson,
  maintenanceEnvelopeToJson,
  type SignedMaintenanceEnvelope,
} from "./maintenance-envelope.ts";

const gateway = "0x1111111111111111111111111111111111111111" as const;
const quote = "0x2222222222222222222222222222222222222222" as const;
const token = "0x3333333333333333333333333333333333333333" as const;
const now = 1_800_000_000n;
const sig = "0x1234" as const;

function mk(action: number, payloadHash: `0x${string}`, snapshotHash: `0x${string}`, id: string) {
  return makeJob({ gateway, chainId: 1883n, action, payloadHash, snapshotHash, jobId: jobIdFromOp(id), nowSec: now, ttlSec: 600 });
}

const hopsHash = hashHops([]);
const settle: SignedMaintenanceEnvelope = {
  kind: "settleQuote",
  job: mk(ACTION_SETTLE_QUOTE, settlePayload(quote, 100n, 90n, hopsHash), hopsHash, "settle"),
  signature: sig,
  quote,
  amount: 100n,
  minOut: 90n,
  hops: [],
};
assert.doesNotThrow(() => assertMaintenanceEnvelope(settle, { gateway, chainId: 1883n, nowSec: now + 1n }));
assert.ok(encodeRelayCalldata(settle).startsWith("0x"));
assert.throws(() => assertMaintenanceEnvelope({ ...settle, minOut: 89n }), /payloadHash mismatch/);
assert.throws(() => assertMaintenanceEnvelope(settle, { chainId: 5042n }), /wrong chain/);
assert.throws(() => assertMaintenanceEnvelope(settle, { gateway: quote }), /wrong gateway/);
assert.throws(() => assertMaintenanceEnvelope(settle, { nowSec: now - 1n }), /too early/);
assert.throws(() => assertMaintenanceEnvelope(settle, { nowSec: now + 601n }), /expired/);

const selfBurn: SignedMaintenanceEnvelope = {
  kind: "selfBurn",
  job: mk(ACTION_SELF_BURN, selfBurnPayload(token, 50n, 45n), ZERO32, "selfburn"),
  signature: sig,
  token,
  amount: 50n,
  minOut: 45n,
};
assert.doesNotThrow(() => assertMaintenanceEnvelope(selfBurn));
assert.throws(() => assertMaintenanceEnvelope({ ...selfBurn, job: { ...selfBurn.job, snapshotHash: hopsHash } }), /snapshotHash mismatch/);

const top10: SignedMaintenanceEnvelope = {
  kind: "top10",
  job: mk(ACTION_TOP10_BUYBACK, top10Payload(token, 70n, 60n, hopsHash), hopsHash, "top10"),
  signature: sig,
  token,
  amount: 70n,
  minOut: 60n,
  hops: [],
};
assert.doesNotThrow(() => assertMaintenanceEnvelope(top10));

const buyback: SignedMaintenanceEnvelope = {
  kind: "buyback",
  job: mk(ACTION_BUYBACK, buybackPayload(quote, 80n, 75n, hopsHash), hopsHash, "buyback"),
  signature: sig,
  quote,
  amount: 80n,
  minOut: 75n,
  hops: [],
};
assert.doesNotThrow(() => assertMaintenanceEnvelope(buyback));

const rollHash = rollPayload(9n);
const roll: SignedMaintenanceEnvelope = {
  kind: "rollEpoch",
  job: mk(ACTION_ROLL_EPOCH, rollHash, rollHash, "roll"),
  signature: sig,
  epochId: 9n,
};
assert.doesNotThrow(() => assertMaintenanceEnvelope(roll));

const valuation = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const health = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const targets = [token];
const weights = [10_000n];
const epochHash = epochSnapshotHash(7n, targets, weights, valuation, health);
const epoch: SignedMaintenanceEnvelope = {
  kind: "submitEpoch",
  job: mk(ACTION_SUBMIT_EPOCH, epochHash, epochHash, "epoch"),
  signature: sig,
  epochId: 7n,
  targets,
  weights,
  valuationSnapshot: valuation,
  pricingHealthHash: health,
};
assert.doesNotThrow(() => assertMaintenanceEnvelope(epoch));
assert.throws(() => assertMaintenanceEnvelope({ ...epoch, weights: [9_999n] }), /payloadHash mismatch/);

const json = maintenanceEnvelopeToJson(settle);
const parsed = maintenanceEnvelopeFromJson(json, true) as SignedMaintenanceEnvelope;
assert.equal(parsed.job.chainId, settle.job.chainId);
assert.equal(parsed.amount, settle.amount);
assert.equal(parsed.signature, settle.signature);
assert.doesNotThrow(() => assertMaintenanceEnvelope(parsed));

console.log("maintenance envelope tests: ok");
