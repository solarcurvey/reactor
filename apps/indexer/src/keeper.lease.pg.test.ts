/**
 * Two independent Postgres pools = two Keeper workers.
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg-lease
 *
 * Date.now() millisecond fences overflow 32-bit INTEGER. This test promotes
 * `leader_locks.ts` / `lease_until` to BIGINT when needed so it runs before
 * issue #1 lands, and still exercises the BIGINT path after that merge.
 */
import { openStore, type Store } from "./db.ts";
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const INT32_MAX = 2_147_483_647;
const nowMs = Date.now();
assert(nowMs > INT32_MAX, `Date.now() ${nowMs} must exceed INTEGER max ${INT32_MAX}`);

async function ensureLeaseMsColumns(store: Store) {
  for (const col of ["ts", "lease_until"]) {
    await store.exec(`ALTER TABLE leader_locks ALTER COLUMN ${col} TYPE BIGINT`).catch(() => undefined);
  }
  const rows = await store.all<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name='leader_locks' AND column_name IN ('ts','lease_until')`,
  );
  for (const col of ["ts", "lease_until"]) {
    const t = rows.find((r) => r.column_name === col)?.data_type;
    assert(t === "bigint", `${col} must be bigint (got ${t})`);
  }
}

const lock = `reactor-keeper-pg-${nowMs}`;
const workerA = await openStore({ databaseUrl: url });
const workerB = await openStore({ databaseUrl: url });
assert(workerA.dialect === "postgres" && workerB.dialect === "postgres", "two postgres pools");
assert(workerA !== workerB, "independent Store instances");

await ensureLeaseMsColumns(workerA);
await workerA.run("DELETE FROM leader_locks WHERE name=?", lock);

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
  let followerWon = false;
  let followerSent = false;
  const held = await withLeaderLock(
    workerA,
    "worker-a",
    async (lease) => {
      const started = Date.now();
      while (Date.now() - started < 900) {
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
        await sleep(50);
      }
      assert(await stillLeader(workerB, lease), "worker B's pool still sees A's renewed fence");
      await withBroadcastFence(workerA, lease, async () => "ok");
      return "held";
    },
    { ttlMs: 400, renewEveryMs: 80, name: lock },
  );
  assert(held === "held", "A completed a tick longer than the original TTL");
  assert(!followerWon && !followerSent, "B cannot acquire or broadcast while A renews");
}

{
  const stale = await acquireLeaderLease(workerA, "worker-a", 180, lock);
  assert(stale, "A holds a short lease");
  await sleep(280);
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
}

{
  const crashed = await acquireLeaderLease(workerA, "worker-a", 180, lock);
  assert(crashed, "A acquired before crash");
  await workerA.close();
  await sleep(280);
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
}

await workerB.close();
console.log("keeper lease two-worker postgres tests ok");
