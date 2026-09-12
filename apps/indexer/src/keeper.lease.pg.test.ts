/**
 * Two independent Postgres pools = two Keeper workers.
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg-lease
 *
 * Schema v6 (#19 / #1) stores `leader_locks.ts` / `lease_until` as BIGINT so
 * Date.now() millisecond fences persist. AC1 uses the real wall clock for that.
 * TTL / renew / expiry cases inject a fake lease clock so CI load cannot miss a
 * `setInterval` tick (same flake as `keeper.lease.test.ts` after #47).
 */
import { openStore, type Store } from "./db.ts";
import { SCHEMA_VERSION } from "./migrations.ts";
import { withFakeLeaseTime } from "./lease-clock.fake.ts";
import {
  acquireLeaderLease,
  renewLeaderLease,
  stillLeader,
  withBroadcastFence,
  withLeaderLock,
  LeaderLeaseLostError,
  type LeaderLease,
} from "./keeper-jobs.ts";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("postgres")) {
  console.error("DATABASE_URL must be postgres://… — two-worker proof is Postgres-only");
  process.exit(2);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const INT32_MAX = 2_147_483_647;
const nowMs = Date.now();
assert(nowMs > INT32_MAX, `Date.now() ${nowMs} must exceed INTEGER max ${INT32_MAX}`);

async function assertLeaseMsColumns(store: Store) {
  const ver = await store.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
  assert(Number(ver?.n) >= SCHEMA_VERSION && SCHEMA_VERSION >= 6, `schema v${ver?.n} must include BIGINT ms columns`);
  const rows = await store.all<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name='leader_locks' AND column_name IN ('ts','lease_until')`,
  );
  for (const col of ["ts", "lease_until"]) {
    const t = rows.find((r) => r.column_name === col)?.data_type;
    assert(t === "bigint", `${col} must be bigint from schema v6 (got ${t})`);
  }
}

const lock = `reactor-keeper-pg-${nowMs}`;
const workerA = await openStore({ databaseUrl: url });
const workerB = await openStore({ databaseUrl: url });
assert(workerA.dialect === "postgres" && workerB.dialect === "postgres", "two postgres pools");
assert(workerA !== workerB, "independent Store instances");

await assertLeaseMsColumns(workerA);
await workerA.run("DELETE FROM leader_locks WHERE name=?", lock);

/* AC1 — simultaneous acquire → exactly one winner */
{
  const [first, second] = await Promise.all([
    acquireLeaderLease(workerA, "worker-a", 5_000, lock),
    acquireLeaderLease(workerB, "worker-b", 5_000, lock),
  ]);
  const won = [first, second].filter(Boolean) as LeaderLease[];
  assert(won.length === 1, `simultaneous acquire must have exactly one winner (got ${won.length})`);
  const leader = won[0]!;
  const followerStore = leader.owner === "worker-a" ? workerB : workerA;
  const leaderStore = leader.owner === "worker-a" ? workerA : workerB;
  assert(await stillLeader(leaderStore, leader), "winner still holds on its own pool");
  assert(!(await stillLeader(followerStore, { ...leader, owner: leader.owner === "worker-a" ? "worker-b" : "worker-a" })), "loser is not leader");
  const row = await workerB.get<{ ts: string | number; owner: string }>("SELECT owner, ts FROM leader_locks WHERE name=?", lock);
  assert(row?.owner === leader.owner, "both pools see the same winner");
  assert(Number(row?.ts) === leader.fence && Number(row?.ts) > INT32_MAX, "fence is Date.now() ms on BIGINT");
  await leaderStore.releaseLease(lock, leader.owner, leader.fence);
}

{
  const gens: number[] = [];
  for (let i = 0; i < 8; i++) {
    const lease = await acquireLeaderLease(workerA, "worker-a", 5_000, lock);
    assert(lease, `same-ms re-acquire ${i}`);
    gens.push(lease.fence);
  }
  assert(new Set(gens).size === 8, "Postgres fence is unique across same-ms re-acquires");
  for (let i = 1; i < gens.length; i++) assert(gens[i]! > gens[i - 1]!, "Postgres fence is monotonic");
  await workerA.releaseLease(lock, "worker-a", gens[gens.length - 1]!);
}

/* AC2 — A renews past original TTL; B cannot acquire or broadcast (injected clock) */
await withFakeLeaseTime(async (time) => {
  let followerWon = false;
  let followerSent = false;
  const held = await withLeaderLock(
    workerA,
    "worker-a",
    async (lease) => {
      for (let waited = 0; waited < 900; waited += 50) {
        await time.advance(50);
        const steal = await acquireLeaderLease(workerB, "worker-b", 400, lock);
        if (steal) {
          followerWon = true;
          try {
            await withBroadcastFence(workerB, steal, async () => {
              followerSent = true;
            });
          } catch {
            /* fence should refuse even if steal raced */
          }
          await workerB.releaseLease(lock, steal.owner, steal.fence);
          break;
        }
      }
      assert(await stillLeader(workerB, lease), "worker B's pool still sees A's renewed fence");
      await withBroadcastFence(workerA, lease, async () => "ok");
      return "held";
    },
    { ttlMs: 400, renewEveryMs: 80, name: lock, scheduler: time.scheduler },
  );
  assert(held === "held", "A completed a tick longer than the original TTL");
  assert(!followerWon && !followerSent, "B cannot acquire or broadcast while A renews");
});

/* AC3 + AC4 — after A expires, B gets a new fence; stale A cannot renew / drop B / send */
await withFakeLeaseTime(async (time) => {
  const stale = await acquireLeaderLease(workerA, "worker-a", 180, lock);
  assert(stale, "A holds a short lease");
  await time.advance(280);
  const fresh = await acquireLeaderLease(workerB, "worker-b", 5_000, lock);
  assert(fresh, "B takes over after A expires without renew");
  assert(fresh.fence !== stale.fence && fresh.fence > INT32_MAX, "B gets a new millisecond fence");
  assert(!(await renewLeaderLease(workerA, stale)), "stale A cannot renew from its own pool");
  await workerA.releaseLease(lock, stale.owner, stale.fence);
  assert(await stillLeader(workerB, fresh), "stale A release must not drop B's generation");
  let sent = false;
  let threw = false;
  try {
    await withBroadcastFence(workerA, stale, async () => {
      sent = true;
    });
  } catch (e) {
    threw = e instanceof LeaderLeaseLostError;
  }
  assert(threw && !sent, "stale A cannot pass withBroadcastFence");
  await workerB.releaseLease(lock, fresh.owner, fresh.fence);
});

/* AC5 — worker crash (no release) + expiry → safe takeover */
await withFakeLeaseTime(async (time) => {
  const crashed = await acquireLeaderLease(workerA, "worker-a", 180, lock);
  assert(crashed, "A acquired before crash");
  await workerA.close();
  await time.advance(280);
  const takeover = await acquireLeaderLease(workerB, "worker-b", 5_000, lock);
  assert(takeover, "B takes over after crash + expiry (no explicit release)");
  assert(takeover.fence !== crashed.fence, "takeover is a new fence");
  const resurrected = await openStore({ databaseUrl: url });
  assert(!(await renewLeaderLease(resurrected, crashed)), "crashed worker cannot renew stale fence");
  await resurrected.releaseLease(lock, crashed.owner, crashed.fence);
  assert(await stillLeader(workerB, takeover), "crashed release must not drop B");
  let sent = false;
  try {
    await withBroadcastFence(resurrected, crashed, async () => {
      sent = true;
    });
  } catch (e) {
    assert(e instanceof LeaderLeaseLostError, "crash-stale fence refuses broadcast");
  }
  assert(!sent, "crashed worker must not broadcast after takeover");
  await workerB.releaseLease(lock, takeover.owner, takeover.fence);
  await resurrected.run("DELETE FROM leader_locks WHERE name=?", lock);
  await resurrected.close();
});

await workerB.close();
console.log("keeper lease two-worker postgres tests ok");
