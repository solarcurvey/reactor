import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  ACTION_SETTLE_QUOTE,
  hashHops,
  jobIdFromOp,
  makeJob,
  maintenanceDomain,
  MAINTENANCE_JOB_TYPES,
  settlePayload,
} from "../../../packages/reactor/src/maintenance-job.ts";
import { maintenanceEnvelopeToJson, type UnsignedMaintenanceEnvelope } from "../../../packages/reactor/src/maintenance-envelope.ts";
import { openStore } from "./db.ts";
import {
  attachSignedMaintenance,
  enqueueUnsignedMaintenance,
  managedMaintenanceResults,
  nextSignedMaintenance,
  nextUnsignedMaintenance,
  recordManagedRelayResult,
} from "./maintenance-queue.ts";

const dir = mkdtempSync(join(tmpdir(), "reactor-managed-queue-"));
const store = await openStore({ sqlitePath: join(dir, "queue.sqlite") });
try {
  const gateway = "0x1111111111111111111111111111111111111111" as const;
  const quote = "0x2222222222222222222222222222222222222222" as const;
  const nowSec = 1_800_000_000n;
  const hopsHash = hashHops([]);
  const unsigned: UnsignedMaintenanceEnvelope = {
    kind: "settleQuote",
    job: makeJob({
      gateway,
      chainId: 1883n,
      action: ACTION_SETTLE_QUOTE,
      payloadHash: settlePayload(quote, 100n, 90n, hopsHash),
      snapshotHash: hopsHash,
      jobId: jobIdFromOp("managed-queue-test"),
      nowSec,
      ttlSec: 600,
    }),
    quote,
    amount: 100n,
    minOut: 90n,
    hops: [],
  };

  const first = await enqueueUnsignedMaintenance(store, maintenanceEnvelopeToJson(unsigned), 1000);
  assert.equal(first.inserted, true);
  const duplicate = await enqueueUnsignedMaintenance(store, maintenanceEnvelopeToJson(unsigned), 1001);
  assert.equal(duplicate.inserted, false);
  const queued = await nextUnsignedMaintenance(store, Number(nowSec + 1n));
  assert.equal(queued?.job.jobId, unsigned.job.jobId);

  await assert.rejects(
    () => enqueueUnsignedMaintenance(store, maintenanceEnvelopeToJson({ ...unsigned, minOut: 89n }), 1002),
    /payloadHash mismatch|collision/,
  );

  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const signature = await account.signTypedData({
    domain: maintenanceDomain(unsigned.job.chainId, unsigned.job.gateway),
    types: MAINTENANCE_JOB_TYPES,
    primaryType: "MaintenanceJob",
    message: unsigned.job,
  });
  const signed = { ...unsigned, signature };
  await attachSignedMaintenance(store, maintenanceEnvelopeToJson(signed), 1100);
  assert.equal((await nextSignedMaintenance(store, Number(nowSec + 1n)))?.signature, signature);

  await recordManagedRelayResult(store, {
    status: "failed",
    jobId: unsigned.job.jobId,
    relay: "A",
    error: "rpc down",
  }, 1200);
  assert.ok(await nextSignedMaintenance(store, Number(nowSec + 2n)), "failed A must leave job available to B");

  await recordManagedRelayResult(store, {
    status: "consumed",
    jobId: unsigned.job.jobId,
    relay: "B",
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }, 1300);
  assert.equal(await nextSignedMaintenance(store, Number(nowSec + 3n)), undefined, "consumed job must leave ready queue");
  const results = await managedMaintenanceResults(store, unsigned.job.jobId);
  assert.deepEqual(results.map((r) => r.status), ["failed", "consumed"]);

  await assert.rejects(
    () => attachSignedMaintenance(store, maintenanceEnvelopeToJson({ ...signed, minOut: 89n }), 1400),
    /payloadHash mismatch|completed|differs/,
  );

  console.log("managed maintenance queue tests: ok");
} finally {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
}
