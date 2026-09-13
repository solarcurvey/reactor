import assert from "node:assert/strict";
import {
  ACTION_BUYBACK,
  ACTION_ROLL_EPOCH,
  ACTION_SELF_BURN,
  ACTION_SETTLE_QUOTE,
  ACTION_SUBMIT_EPOCH,
  ACTION_TOP10_BUYBACK,
  buybackPayload,
  encodeBuybackCall,
  encodeRollCall,
  encodeSelfBurnCall,
  encodeSettleCall,
  encodeSubmitEpochCall,
  encodeTop10Call,
  epochSnapshotHash,
  hashHops,
  jobIdFromOp,
  makeJob,
  rollPayload,
  selfBurnPayload,
  settlePayload,
  top10Payload,
} from "../../../packages/reactor/src/maintenance-job.ts";
import { unsignedEnvelopeFromGatewayCalldata } from "./maintenance-planner-bridge.ts";

const gateway = "0x1111111111111111111111111111111111111111" as const;
const token = "0x2222222222222222222222222222222222222222" as const;
const quote = "0x3333333333333333333333333333333333333333" as const;
const valuation = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const health = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const zero = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const nowSec = 1_800_000_000n;
const dummySig = "0x" as const;
const hops: [] = [];
const hopsHash = hashHops(hops);

function job(action: number, payloadHash: `0x${string}`, snapshotHash: `0x${string}`, id: string) {
  return makeJob({ gateway, chainId: 1883n, action, payloadHash, snapshotHash, jobId: jobIdFromOp(id), nowSec, ttlSec: 600 });
}

const selfBurnJob = job(ACTION_SELF_BURN, selfBurnPayload(token, 100n, 90n), zero, "bridge-selfburn");
const selfBurn = unsignedEnvelopeFromGatewayCalldata(encodeSelfBurnCall(selfBurnJob, dummySig, token, 100n, 90n));
assert.equal(selfBurn.kind, "selfBurn");
assert.equal(selfBurn.token, token);
assert.equal(selfBurn.amount, 100n);
assert.equal(selfBurn.minOut, 90n);

const settleJob = job(ACTION_SETTLE_QUOTE, settlePayload(quote, 200n, 180n, hopsHash), hopsHash, "bridge-settle");
const settle = unsignedEnvelopeFromGatewayCalldata(encodeSettleCall(settleJob, dummySig, quote, 200n, hops, 180n));
assert.equal(settle.kind, "settleQuote");
assert.equal(settle.quote, quote);
assert.equal(settle.amount, 200n);
assert.equal(settle.minOut, 180n);

const weights = [10_000n];
const snap = epochSnapshotHash(7n, [token], weights, valuation, health);
const epochJob = job(ACTION_SUBMIT_EPOCH, snap, snap, "bridge-epoch");
const epoch = unsignedEnvelopeFromGatewayCalldata(
  encodeSubmitEpochCall(epochJob, dummySig, 7n, [token], weights, valuation, health),
);
assert.equal(epoch.kind, "submitEpoch");
assert.equal(epoch.epochId, 7n);
assert.deepEqual(epoch.targets, [token]);
assert.deepEqual(epoch.weights, weights);

const topJob = job(ACTION_TOP10_BUYBACK, top10Payload(token, 300n, 250n, hopsHash), hopsHash, "bridge-top10");
const top = unsignedEnvelopeFromGatewayCalldata(encodeTop10Call(topJob, dummySig, token, 300n, hops, 250n));
assert.equal(top.kind, "top10");
assert.equal(top.amount, 300n);

const rollHash = rollPayload(7n);
const rollJob = job(ACTION_ROLL_EPOCH, rollHash, rollHash, "bridge-roll");
const roll = unsignedEnvelopeFromGatewayCalldata(encodeRollCall(rollJob, dummySig, 7n));
assert.equal(roll.kind, "rollEpoch");
assert.equal(roll.epochId, 7n);

const buyJob = job(ACTION_BUYBACK, buybackPayload(quote, 400n, 350n, hopsHash), hopsHash, "bridge-buyback");
const buy = unsignedEnvelopeFromGatewayCalldata(encodeBuybackCall(buyJob, dummySig, quote, 400n, hops, 350n));
assert.equal(buy.kind, "buyback");
assert.equal(buy.quote, quote);
assert.equal(buy.amount, 400n);

assert.throws(
  () => unsignedEnvelopeFromGatewayCalldata(encodeSelfBurnCall({ ...selfBurnJob, payloadHash: hopsHash }, dummySig, token, 100n, 90n)),
  /payloadHash mismatch/,
);

console.log("managed planner bridge tests: ok");
