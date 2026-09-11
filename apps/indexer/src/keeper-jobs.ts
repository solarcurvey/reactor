import type { Store } from "./db.ts";
import type { Hex } from "viem";

export type JobState = {
  status: "done" | "pending" | "failed" | "ambiguous";
  hash?: string;
  nonce?: string;
  receipt?: string;
  ts: number;
  note?: string;
};

export async function loadJob(store: Store, id: string): Promise<JobState | undefined> {
  const row = await store.get<{ status: string; hash: string; nonce: string; receipt: string; note: string; ts: number }>(
    "SELECT status,hash,nonce,receipt,note,ts FROM keeper_operations WHERE id=?",
    id,
  );
  if (!row) return undefined;
  return { status: row.status as JobState["status"], hash: row.hash, nonce: row.nonce, receipt: row.receipt, note: row.note, ts: Number(row.ts) };
}

export async function saveJob(store: Store, id: string, job: JobState, kind = "keeper") {
  await store.run(
    `INSERT INTO keeper_operations(id,kind,status,hash,nonce,receipt,note,request_id,op_id,ts)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, hash=excluded.hash, nonce=excluded.nonce, receipt=excluded.receipt, note=excluded.note, ts=excluded.ts`,
    id,
    kind,
    job.status,
    job.hash ?? "",
    job.nonce ?? "",
    job.receipt ?? "",
    job.note ?? "",
    "",
    id,
    job.ts,
  );
}

export async function withLeaderLock<T>(store: Store, owner: string, fn: () => Promise<T>): Promise<T | undefined> {
  const ok = await store.tryAdvisoryLock("reactor-keeper", owner, 45_000);
  if (!ok) return undefined;
  try {
    return await fn();
  } finally {
    await store.releaseLock("reactor-keeper", owner);
  }
}

export function assertKeySeparation(opts: { keeper?: string; pricing?: string; guardian?: string }) {
  const keys = [opts.keeper, opts.pricing, opts.guardian].filter(Boolean);
  const set = new Set(keys);
  if (set.size !== keys.length) throw new Error("key reuse forbidden: Guardian / Keeper / Pricing signer must be distinct");
}

void (null as unknown as Hex);
