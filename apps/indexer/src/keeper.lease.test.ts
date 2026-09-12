import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import {
  acquireLeaderLease,
  renewLeaderLease,
  requireLeaderLease,
  resolveLeaseIntervals,
  stillLeader,
  withBroadcastFence,
  withLeaderLock,
  LeaderLeaseLostError,
  KEEPER_LOCK_NAME,
} from "./keeper-jobs.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const dir = mkdtempSync(join(tmpdir(), "reactor-lease-"));
const store = await openStore({ sqlitePath: join(dir, "lease.sqlite") });

{
  const { ttlMs, renewEveryMs } = resolveLeaseIntervals(50_000, 15_000);
  assert(ttlMs === 50_000 && renewEveryMs === 15_000, "default intervals");
  const clamped = resolveLeaseIntervals(80, 5_000);
  assert(clamped.renewEveryMs < clamped.ttlMs, "renew must sit inside TTL");
}

{
  const a = await acquireLeaderLease(store, "leader-a", 5_000);
  assert(a, "leader acquires");
  const b = await acquireLeaderLease(store, "leader-b", 5_000);
  assert(!b, "follower blocked while lease is live");
  assert(await stillLeader(store, a), "leader still holds");
  await store.releaseLease(KEEPER_LOCK_NAME, a.owner, a.fence);
}

{
  const stale = await acquireLeaderLease(store, "stale", 80);
  assert(stale, "short lease");
  await sleep(120);
  assert(!(await stillLeader(store, stale)), "expired lease is not live");
  assert(!(await renewLeaderLease(store, stale)), "renew must not resurrect an expired lease");
  const fresh = await acquireLeaderLease(store, "fresh", 5_000);
  assert(fresh, "follower may take over only after expiry");
  assert(fresh.fence !== stale.fence, "steal issues a new fence generation");
  assert(!(await renewLeaderLease(store, stale)), "stale fence cannot renew after steal");
  assert(!(await stillLeader(store, stale)), "stale fence is not leader");
  let sent = false;
  let threw = false;
  try {
    await withBroadcastFence(store, stale, async () => {
      sent = true;
      return "broadcast";
    });
  } catch (e) {
    threw = e instanceof LeaderLeaseLostError;
  }
  assert(threw && !sent, "stale leader must not broadcast");
  await requireLeaderLease(store, fresh);
  const ok = await withBroadcastFence(store, fresh, async () => "ok");
  assert(ok === "ok", "live leader may broadcast after renew");
  await store.releaseLease(KEEPER_LOCK_NAME, fresh.owner, fresh.fence);
}

{
  let followerWon = false;
  const held = await withLeaderLock(
    store,
    "long-tick",
    async (lease) => {
      const started = Date.now();
      while (Date.now() - started < 280) {
        const steal = await acquireLeaderLease(store, "overlap", 80);
        if (steal) {
          followerWon = true;
          await store.releaseLease(KEEPER_LOCK_NAME, steal.owner, steal.fence);
          break;
        }
        await sleep(25);
      }
      assert(await stillLeader(store, lease), "renewed leader still holds after work > TTL");
      let broadcasts = 0;
      await withBroadcastFence(store, lease, async () => {
        broadcasts += 1;
      });
      assert(broadcasts === 1, "live long-tick leader may still send");
      return "done";
    },
    { ttlMs: 80, renewEveryMs: 20 },
  );
  assert(held === "done", "withLeaderLock returns fn result");
  assert(!followerWon, "renewal prevents overlapping broadcasters during a long tick");
}

{
  const first = await acquireLeaderLease(store, "same-owner", 5_000);
  assert(first, "first acquire");
  const again = await acquireLeaderLease(store, "same-owner", 5_000);
  assert(again, "same owner may re-acquire");
  assert(again.fence !== first.fence, "re-acquire is a new generation");
  assert(!(await stillLeader(store, first)), "old generation is fenced out");
  await store.releaseLease(KEEPER_LOCK_NAME, first.owner, first.fence);
  assert(await stillLeader(store, again), "fenced release must not drop a newer generation");
  await store.releaseLease(KEEPER_LOCK_NAME, again.owner, again.fence);
}

{
  const blocked = await withLeaderLock(store, "outer", async () => {
    const inner = await withLeaderLock(store, "inner", async () => "nope", { ttlMs: 5_000 });
    assert(inner === undefined, "second owner does not enter the critical section");
    return "outer-ok";
  }, { ttlMs: 5_000 });
  assert(blocked === "outer-ok", "outer leader completed");
}

await store.close();
rmSync(dir, { recursive: true, force: true });
console.log("keeper lease fencing tests ok");
