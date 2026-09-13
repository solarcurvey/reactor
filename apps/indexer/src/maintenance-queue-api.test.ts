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
import { enqueueUnsignedMaintenance } from "./maintenance-queue.ts";
import { startMaintenanceQueueServer } from "./maintenance-queue-api.ts";

process.env.MAINTENANCE_QUEUE_TEST = "1";
const dir = mkdtempSync(join(tmpdir(), "reactor-maint-api-"));
const store = await openStore({ sqlitePath: join(dir, "api.sqlite") });
const tokens = {
  authorizer: "authorizer-token-abcdefghijklmnopqrstuvwxyz",
  "relay-A": "relay-a-token-abcdefghijklmnopqrstuvwxyz",
  "relay-B": "relay-b-token-abcdefghijklmnopqrstuvwxyz",
} as const;
const { server, port } = await startMaintenanceQueueServer({ store, tokens: { ...tokens }, port: 0, host: "127.0.0.1" });
const base = `http://127.0.0.1:${port}`;

async function req(path: string, token?: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

try {
  assert.equal((await req("/health")).status, 200);
  assert.equal((await req("/ops/maintenance/unsigned")).status, 401);

  const gateway = "0x1111111111111111111111111111111111111111" as const;
  const quote = "0x2222222222222222222222222222222222222222" as const;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const hopsHash = hashHops([]);
  const unsigned: UnsignedMaintenanceEnvelope = {
    kind: "settleQuote",
    job: makeJob({
      gateway,
      chainId: 1883n,
      action: ACTION_SETTLE_QUOTE,
      payloadHash: settlePayload(quote, 100n, 90n, hopsHash),
      snapshotHash: hopsHash,
      jobId: jobIdFromOp("managed-api-test"),
      nowSec,
      ttlSec: 600,
    }),
    quote,
    amount: 100n,
    minOut: 90n,
    hops: [],
  };
  await enqueueUnsignedMaintenance(store, maintenanceEnvelopeToJson(unsigned));

  assert.equal((await req("/ops/maintenance/unsigned", tokens["relay-A"])).status, 403, "relay must not read unsigned decision jobs");
  const u = await req("/ops/maintenance/unsigned", tokens.authorizer);
  assert.equal(u.status, 200);
  const uj = await u.json() as { item: unknown };
  assert.ok(uj.item);

  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const signature = await account.signTypedData({
    domain: maintenanceDomain(unsigned.job.chainId, unsigned.job.gateway),
    types: MAINTENANCE_JOB_TYPES,
    primaryType: "MaintenanceJob",
    message: unsigned.job,
  });
  const signedJson = maintenanceEnvelopeToJson({ ...unsigned, signature });
  assert.equal((await req("/ops/maintenance/signed", tokens["relay-A"], { method: "POST", body: JSON.stringify(signedJson) })).status, 403);
  assert.equal((await req("/ops/maintenance/signed", tokens.authorizer, { method: "POST", body: JSON.stringify(signedJson) })).status, 200);

  assert.equal((await req("/ops/maintenance/signed", tokens.authorizer)).status, 403);
  assert.equal((await req("/ops/maintenance/signed", tokens["relay-A"])).status, 200);
  assert.equal((await req("/ops/maintenance/signed", tokens["relay-B"])).status, 200);

  const failed = { status: "failed", jobId: unsigned.job.jobId, relay: "A", error: "rpc down" };
  assert.equal((await req("/ops/maintenance/result", tokens["relay-B"], { method: "POST", body: JSON.stringify(failed) })).status, 403, "relay B cannot impersonate A");
  assert.equal((await req("/ops/maintenance/result", tokens["relay-A"], { method: "POST", body: JSON.stringify(failed) })).status, 200);
  assert.equal((await req("/ops/maintenance/signed", tokens["relay-B"])).status, 200, "A failure must leave B failover job available");

  const consumed = {
    status: "consumed",
    jobId: unsigned.job.jobId,
    relay: "B",
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  assert.equal((await req("/ops/maintenance/result", tokens["relay-B"], { method: "POST", body: JSON.stringify(consumed) })).status, 200);
  assert.equal((await req("/ops/maintenance/signed", tokens["relay-A"])).status, 204);

  console.log("maintenance queue API role tests: ok");
} finally {
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  await store.close();
  rmSync(dir, { recursive: true, force: true });
}
