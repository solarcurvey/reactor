import type { Store } from "./db.ts";
import type { Hex } from "viem";

export const KEEPER_LOCK_NAME = "reactor-keeper";
/** Default leadership TTL. Shorter than some ticks (receipt wait is 60s) — must be renewed, not relied on as a work budget. */
export const KEEPER_LEASE_TTL_MS = Number(process.env.KEEPER_LEASE_TTL_MS ?? 50_000);
/** Renew well inside the TTL so a live leader cannot expire mid-tick. */
export const KEEPER_LEASE_RENEW_MS = Number(process.env.KEEPER_LEASE_RENEW_MS ?? 15_000);

export type LeaderLease = {
  name: string;
  owner: string;
  /** Acquire-generation fence (`leader_locks.ts`). Renew must not change this. */
  fence: number;
  ttlMs: number;
};

export class LeaderLeaseLostError extends Error {
  constructor(message = "leader lease lost — refuse broadcast") {
    super(message);
    this.name = "LeaderLeaseLostError";
  }
}

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

export function resolveLeaseIntervals(ttlMs = KEEPER_LEASE_TTL_MS, renewEveryMs = KEEPER_LEASE_RENEW_MS) {
  const ttl = Math.max(1, Number(ttlMs));
  let renew = Math.max(1, Number(renewEveryMs));
  if (renew >= ttl) renew = Math.max(1, Math.floor(ttl / 3));
  return { ttlMs: ttl, renewEveryMs: renew };
}

export async function acquireLeaderLease(
  store: Store,
  owner: string,
  ttlMs = KEEPER_LEASE_TTL_MS,
  name = KEEPER_LOCK_NAME,
): Promise<LeaderLease | undefined> {
  const fence = await store.acquireLease(name, owner, ttlMs);
  if (fence === null) return undefined;
  return { name, owner, fence, ttlMs };
}

export async function renewLeaderLease(store: Store, lease: LeaderLease): Promise<boolean> {
  return store.renewLease(lease.name, lease.owner, lease.fence, lease.ttlMs);
}

export async function stillLeader(store: Store, lease: LeaderLease): Promise<boolean> {
  return store.hasLease(lease.name, lease.owner, lease.fence);
}

export async function requireLeaderLease(store: Store, lease: LeaderLease): Promise<void> {
  const ok = await renewLeaderLease(store, lease);
  if (!ok) throw new LeaderLeaseLostError();
}

/** Renew immediately, then run `send`. Lost lease → throw, never broadcast. */
export async function withBroadcastFence<T>(store: Store, lease: LeaderLease, send: () => Promise<T>): Promise<T> {
  await requireLeaderLease(store, lease);
  return send();
}

export async function withLeaderLock<T>(
  store: Store,
  owner: string,
  fn: (lease: LeaderLease) => Promise<T>,
  opts?: { ttlMs?: number; renewEveryMs?: number; name?: string },
): Promise<T | undefined> {
  const { ttlMs, renewEveryMs } = resolveLeaseIntervals(opts?.ttlMs, opts?.renewEveryMs);
  const lease = await acquireLeaderLease(store, owner, ttlMs, opts?.name ?? KEEPER_LOCK_NAME);
  if (!lease) return undefined;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  try {
    renewTimer = setInterval(() => {
      void renewLeaderLease(store, lease);
    }, renewEveryMs);
    return await fn(lease);
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    await store.releaseLease(lease.name, lease.owner, lease.fence);
  }
}

export function assertKeySeparation(opts: { keeper?: string; pricing?: string; guardian?: string }) {
  const keys = [opts.keeper, opts.pricing, opts.guardian].filter(Boolean);
  const set = new Set(keys);
  if (set.size !== keys.length) throw new Error("key reuse forbidden: Guardian / Keeper / Pricing signer must be distinct");
}

void (null as unknown as Hex);
