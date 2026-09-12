/**
 * SQLite single-Store unit tests (fast, no Postgres).
 * Production two-worker / failover proof is `keeper.lease.pg.test.ts`
 * (`pnpm --filter indexer test:pg-lease`, CI `postgres-ms-timestamps` + `keeper-lease-pg`).
 *
 * TTL / renew / steal cases use an injected lease clock (`lease-clock.fake.ts`) so
 * CI load cannot miss a `setInterval` renew and fail
 * "renewed leader still holds after work > TTL" (docs-sync after #47).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import { withFakeLeaseTime } from "./lease-clock.fake.ts";
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

await withFakeLeaseTime(async (time) => {
  const stale = await acquireLeaderLease(store, "stale", 120);
  assert(stale, "short lease");
  await time.advance(200);
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
});

await withFakeLeaseTime(async (time) => {
  const lease = await acquireLeaderLease(store, "extend", 180);
  assert(lease, "lease to extend");
  await time.advance(90);
  assert(await renewLeaderLease(store, lease), "mid-life renew");
  await time.advance(120);
  assert(await stillLeader(store, lease), "renew extends past the original TTL");
  assert(!(await acquireLeaderLease(store, "thief", 180)), "cannot steal a renewed lease");
  await store.releaseLease(KEEPER_LOCK_NAME, lease.owner, lease.fence);
});

await withFakeLeaseTime(async (time) => {
  let followerWon = false;
  const held = await withLeaderLock(
    store,
    "long-tick",
    async (lease) => {
      for (let waited = 0; waited < 900; waited += 50) {
        await time.advance(50);
        const steal = await acquireLeaderLease(store, "overlap", 400);
        if (steal) {
          followerWon = true;
          await store.releaseLease(KEEPER_LOCK_NAME, steal.owner, steal.fence);
          break;
        }
      }
      assert(await stillLeader(store, lease), "renewed leader still holds after work > TTL");
      let broadcasts = 0;
      await withBroadcastFence(store, lease, async () => {
        broadcasts += 1;
      });
      assert(broadcasts === 1, "live long-tick leader may still send");
      return "done";
    },
    { ttlMs: 400, renewEveryMs: 80, scheduler: time.scheduler },
  );
  assert(held === "done", "withLeaderLock returns fn result");
  assert(!followerWon, "renewal prevents overlapping broadcasters during a long tick");
});

await withFakeLeaseTime(async (time) => {
  let followerWon = false;
  const held = await withLeaderLock(
    store,
    "no-renew",
    async (lease) => {
      await time.advance(450);
      const steal = await acquireLeaderLease(store, "overlap-expired", 400);
      if (steal) {
        followerWon = true;
        await store.releaseLease(KEEPER_LOCK_NAME, steal.owner, steal.fence);
      }
      assert(!(await stillLeader(store, lease)), "without interval renew, work > TTL loses the fence");
      return "expired";
    },
    {
      ttlMs: 400,
      renewEveryMs: 80,
      scheduler: { start: () => ({ stop() {} }) },
    },
  );
  assert(held === "expired", "critical section still returns after lease loss");
  assert(followerWon, "follower may take over only when the leader stops renewing");
});

{
  const gens: number[] = [];
  let last: Awaited<ReturnType<typeof acquireLeaderLease>>;
  for (let i = 0; i < 8; i++) {
    last = await acquireLeaderLease(store, "same-owner", 5_000);
    assert(last, `re-acquire ${i}`);
    gens.push(last.fence);
  }
  const unique = new Set(gens);
  assert(unique.size === gens.length, "same-ms re-acquire must mint a new fence");
  for (let i = 1; i < gens.length; i++) assert(gens[i]! > gens[i - 1]!, "fence is monotonic");
  const first = { name: KEEPER_LOCK_NAME, owner: "same-owner", fence: gens[0]!, ttlMs: 5_000 };
  assert(!(await stillLeader(store, first)), "old generation is fenced out");
  await store.releaseLease(KEEPER_LOCK_NAME, first.owner, first.fence);
  assert(await stillLeader(store, last!), "fenced release must not drop a newer generation");
  await store.releaseLease(KEEPER_LOCK_NAME, last!.owner, last!.fence);
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
