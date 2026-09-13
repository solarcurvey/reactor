import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import {
  assertMaintenanceEnvelope,
  maintenanceEnvelopeFromJson,
  maintenanceEnvelopeToJson,
  type SignedMaintenanceEnvelope,
  type UnsignedMaintenanceEnvelope,
} from "../../../packages/reactor/src/maintenance-envelope.ts";
import type { Store } from "./db.ts";

export type ManagedMaintenanceStatus = "unsigned" | "signed" | "completed";
export type ManagedRelayResultStatus = "consumed" | "already-used" | "replay" | "ambiguous" | "failed";

export type ManagedMaintenanceRow = {
  job_id: string;
  kind: string;
  status: ManagedMaintenanceStatus;
  unsigned_json: string;
  signed_json: string;
  created_ts: number;
  updated_ts: number;
  valid_after: number;
  deadline: number;
  payload_hash: string;
  snapshot_hash: string;
};

export type ManagedRelayResult = {
  status: ManagedRelayResultStatus;
  jobId: Hex;
  relay: string;
  txHash?: Hex;
  error?: string;
  address?: string;
};

const VALID_RESULT = new Set<ManagedRelayResultStatus>(["consumed", "already-used", "replay", "ambiguous", "failed"]);

export async function ensureManagedMaintenanceQueue(store: Store): Promise<void> {
  await store.exec(`
    CREATE TABLE IF NOT EXISTS managed_maintenance_jobs (
      job_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      unsigned_json TEXT NOT NULL,
      signed_json TEXT NOT NULL DEFAULT '',
      created_ts BIGINT NOT NULL,
      updated_ts BIGINT NOT NULL,
      valid_after BIGINT NOT NULL,
      deadline BIGINT NOT NULL,
      payload_hash TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS managed_maintenance_jobs_ready
      ON managed_maintenance_jobs(status, deadline, created_ts);
    CREATE TABLE IF NOT EXISTS managed_maintenance_results (
      result_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      relay TEXT NOT NULL,
      status TEXT NOT NULL,
      tx_hash TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL,
      ts BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS managed_maintenance_results_job
      ON managed_maintenance_results(job_id, ts);
  `);
}

function canonicalUnsigned(env: UnsignedMaintenanceEnvelope): string {
  return JSON.stringify(maintenanceEnvelopeToJson(env));
}

function unsignedFromSigned(env: SignedMaintenanceEnvelope): UnsignedMaintenanceEnvelope {
  const { signature: _signature, ...unsigned } = env;
  return unsigned;
}

function safeInteger(value: bigint, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`${label} outside safe integer range`);
  return n;
}

export async function enqueueUnsignedMaintenance(
  store: Store,
  raw: unknown,
  nowMs = Date.now(),
): Promise<{ inserted: boolean; envelope: UnsignedMaintenanceEnvelope }> {
  await ensureManagedMaintenanceQueue(store);
  const env = maintenanceEnvelopeFromJson(raw, false) as UnsignedMaintenanceEnvelope;
  assertMaintenanceEnvelope(env, { requireLiveWindow: false });
  const jobId = env.job.jobId.toLowerCase();
  const json = canonicalUnsigned(env);
  const existing = await store.get<ManagedMaintenanceRow>(
    "SELECT job_id,kind,status,unsigned_json,signed_json,created_ts,updated_ts,valid_after,deadline,payload_hash,snapshot_hash FROM managed_maintenance_jobs WHERE job_id=?",
    jobId,
  );
  if (existing) {
    if (existing.unsigned_json !== json) throw new Error("maintenance jobId collision with different payload");
    return { inserted: false, envelope: env };
  }
  await store.run(
    `INSERT INTO managed_maintenance_jobs(
       job_id,kind,status,unsigned_json,signed_json,created_ts,updated_ts,valid_after,deadline,payload_hash,snapshot_hash
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    jobId,
    env.kind,
    "unsigned",
    json,
    "",
    nowMs,
    nowMs,
    safeInteger(env.job.validAfter, "validAfter"),
    safeInteger(env.job.deadline, "deadline"),
    env.job.payloadHash.toLowerCase(),
    env.job.snapshotHash.toLowerCase(),
  );
  return { inserted: true, envelope: env };
}

export async function nextUnsignedMaintenance(store: Store, nowSec: number): Promise<UnsignedMaintenanceEnvelope | undefined> {
  await ensureManagedMaintenanceQueue(store);
  const row = await store.get<ManagedMaintenanceRow>(
    `SELECT job_id,kind,status,unsigned_json,signed_json,created_ts,updated_ts,valid_after,deadline,payload_hash,snapshot_hash
       FROM managed_maintenance_jobs
      WHERE status='unsigned' AND valid_after <= ? AND deadline >= ?
      ORDER BY created_ts ASC
      LIMIT 1`,
    nowSec,
    nowSec,
  );
  if (!row) return undefined;
  return maintenanceEnvelopeFromJson(JSON.parse(row.unsigned_json), false) as UnsignedMaintenanceEnvelope;
}

export async function attachSignedMaintenance(
  store: Store,
  raw: unknown,
  nowMs = Date.now(),
): Promise<SignedMaintenanceEnvelope> {
  await ensureManagedMaintenanceQueue(store);
  const signed = maintenanceEnvelopeFromJson(raw, true) as SignedMaintenanceEnvelope;
  assertMaintenanceEnvelope(signed, { requireLiveWindow: false });
  const jobId = signed.job.jobId.toLowerCase();
  const row = await store.get<ManagedMaintenanceRow>(
    "SELECT job_id,kind,status,unsigned_json,signed_json,created_ts,updated_ts,valid_after,deadline,payload_hash,snapshot_hash FROM managed_maintenance_jobs WHERE job_id=?",
    jobId,
  );
  if (!row) throw new Error("signed maintenance job has no canonical unsigned parent");
  if (row.status === "completed") throw new Error("maintenance job already completed");
  if (canonicalUnsigned(unsignedFromSigned(signed)) !== row.unsigned_json) {
    throw new Error("signed maintenance envelope differs from canonical unsigned job");
  }
  const signedJson = JSON.stringify(maintenanceEnvelopeToJson(signed));
  if (row.signed_json && row.signed_json !== signedJson) throw new Error("maintenance job already has a different signature");
  await store.run(
    "UPDATE managed_maintenance_jobs SET status='signed', signed_json=?, updated_ts=? WHERE job_id=? AND status != 'completed'",
    signedJson,
    nowMs,
    jobId,
  );
  return signed;
}

export async function nextSignedMaintenance(store: Store, nowSec: number): Promise<SignedMaintenanceEnvelope | undefined> {
  await ensureManagedMaintenanceQueue(store);
  const row = await store.get<ManagedMaintenanceRow>(
    `SELECT job_id,kind,status,unsigned_json,signed_json,created_ts,updated_ts,valid_after,deadline,payload_hash,snapshot_hash
       FROM managed_maintenance_jobs
      WHERE status='signed' AND signed_json != '' AND valid_after <= ? AND deadline >= ?
      ORDER BY created_ts ASC
      LIMIT 1`,
    nowSec,
    nowSec,
  );
  if (!row) return undefined;
  return maintenanceEnvelopeFromJson(JSON.parse(row.signed_json), true) as SignedMaintenanceEnvelope;
}

export async function recordManagedRelayResult(
  store: Store,
  input: ManagedRelayResult,
  nowMs = Date.now(),
): Promise<void> {
  await ensureManagedMaintenanceQueue(store);
  if (!VALID_RESULT.has(input.status)) throw new Error("invalid managed relay result status");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.jobId)) throw new Error("invalid managed relay jobId");
  if (!input.relay || input.relay.length > 64) throw new Error("invalid managed relay label");
  const jobId = input.jobId.toLowerCase();
  const row = await store.get<ManagedMaintenanceRow>(
    "SELECT job_id,kind,status,unsigned_json,signed_json,created_ts,updated_ts,valid_after,deadline,payload_hash,snapshot_hash FROM managed_maintenance_jobs WHERE job_id=?",
    jobId,
  );
  if (!row) throw new Error("managed relay result references unknown job");
  const resultJson = JSON.stringify(input);
  await store.run(
    `INSERT INTO managed_maintenance_results(result_id,job_id,relay,status,tx_hash,result_json,ts)
     VALUES(?,?,?,?,?,?,?)`,
    randomUUID(),
    jobId,
    input.relay,
    input.status,
    input.txHash ?? "",
    resultJson,
    nowMs,
  );
  if (input.status === "consumed" || input.status === "already-used" || input.status === "replay") {
    await store.run(
      "UPDATE managed_maintenance_jobs SET status='completed', updated_ts=? WHERE job_id=?",
      nowMs,
      jobId,
    );
  }
}

export async function managedMaintenanceResults(store: Store, jobId: Hex): Promise<ManagedRelayResult[]> {
  await ensureManagedMaintenanceQueue(store);
  const rows = await store.all<{ result_json: string }>(
    "SELECT result_json FROM managed_maintenance_results WHERE job_id=? ORDER BY ts ASC",
    jobId.toLowerCase(),
  );
  return rows.map((r) => JSON.parse(r.result_json) as ManagedRelayResult);
}
