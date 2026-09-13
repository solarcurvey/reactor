import {
  ACTION_SELF_BURN,
  ACTION_SUBMIT_EPOCH,
  HOPS_SEED,
  MAINTENANCE_JOB_TYPEHASH,
  MAINTENANCE_JOB_TYPESTRING,
  epochSnapshotHash,
  hashHops,
  jobIdFromOp,
  makeJob,
  maintenanceDomainSeparator,
  maintenanceJobDigest,
  pricingHealthHash,
  selfBurnPayload,
  valuationSnapshotHash,
} from "./maintenance-job.ts";
import { keccak256, toBytes } from "viem";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(MAINTENANCE_JOB_TYPEHASH === keccak256(toBytes(MAINTENANCE_JOB_TYPESTRING)), "typehash");
assert(HOPS_SEED === keccak256(toBytes("REACTOR.MaintenanceHops.v1")), "hops seed");

const hops = hashHops([
  {
    adapter: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    minOut: 9_850n,
    data: "0x",
  },
]);
assert(hops !== HOPS_SEED, "hops bind adapter/minOut");
const weaker = hashHops([
  {
    adapter: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    minOut: 1n,
    data: "0x",
  },
]);
assert(hops !== weaker, "relayer cannot weaken hop floors");

const a = "0x00000000000000000000000000000000000000aa" as const;
const b = "0x00000000000000000000000000000000000000bb" as const;
const honest = epochSnapshotHash(1n, [a], [10_000n], keccak256(toBytes("canonical")), keccak256(toBytes("ok")));
const swapped = epochSnapshotHash(1n, [b], [10_000n], keccak256(toBytes("canonical")), keccak256(toBytes("ok")));
assert(honest !== swapped, "targets bind snapshot");
const forgedHealth = epochSnapshotHash(1n, [a], [10_000n], keccak256(toBytes("canonical")), keccak256(toBytes("bad")));
assert(honest !== forgedHealth, "pricing-health binds snapshot");

const snap = valuationSnapshotHash({
  source: "valuation-service",
  computedTs: 1,
  pauseEpoch: false,
  rows: [{ token: a, weightBps: 10_000 }],
});
const other = valuationSnapshotHash({
  source: "valuation-service",
  computedTs: 1,
  pauseEpoch: false,
  rows: [{ token: b, weightBps: 10_000 }],
});
assert(snap !== other, "GET /top10 rows bind valuation snapshot");
assert(pricingHealthHash({ ok: true }) !== pricingHealthHash({ ok: false }), "health json binds");

const gateway = "0x0000000000000000000000000000000000000011" as const;
const domain = maintenanceDomainSeparator(5042002n, gateway);
const job = makeJob({
  gateway,
  chainId: 5042002n,
  action: ACTION_SELF_BURN,
  payloadHash: selfBurnPayload(a, 100n, 2n),
  jobId: jobIdFromOp("selfburn:aa:100"),
  nowSec: 1_700_000_000n,
  snapshotHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
});
const d1 = maintenanceJobDigest(domain, job);
const otherChain = maintenanceJobDigest(maintenanceDomainSeparator(1n, gateway), { ...job, chainId: 1n });
assert(d1 !== otherChain, "wrong-chain digest differs");
assert(job.action === ACTION_SELF_BURN && ACTION_SUBMIT_EPOCH === 2, "action ids");
try {
  makeJob({ ...job, nowSec: 1_700_000_000n, ttlSec: 30 * 60 + 1, snapshotHash: job.snapshotHash });
  throw new Error("overlong ttl must throw");
} catch (e) {
  assert(e instanceof Error && /30m/.test(e.message), "overlong signed window rejected offchain");
}
console.log("maintenance-job tests ok");
