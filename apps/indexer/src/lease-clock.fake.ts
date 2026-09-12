/**
 * Deterministic lease clock for unit / pg-lease tests.
 * Production Keeper still uses `Date.now()` + `setInterval` (see `lease-clock.ts`).
 */
import { setLeaseClock, type LeaseClock } from "./lease-clock.ts";
import type { LeaseRenewScheduler } from "./lease-clock.ts";

type Job = {
  due: number;
  every: number;
  tick: () => Promise<void>;
  live: boolean;
};

export type FakeLeaseTime = {
  now(): number;
  /** Advance virtual time and await due renew ticks in chronological order. */
  advance(ms: number): Promise<void>;
  scheduler: LeaseRenewScheduler;
  install(): void;
  restore(): void;
};

export function createFakeLeaseTime(startMs = 1_800_000_000_000): FakeLeaseTime {
  let now = startMs;
  const jobs: Job[] = [];
  let installed = false;
  const clock: LeaseClock = { now: () => now };

  async function fireDue(limit: number) {
    for (let n = 0; n < 64; n++) {
      const next = jobs.filter((j) => j.live && j.due <= limit).sort((a, b) => a.due - b.due)[0];
      if (!next) return;
      now = next.due;
      next.due += next.every;
      await next.tick();
    }
    throw new Error("fake lease clock: too many renew ticks in one advance");
  }

  return {
    now: () => now,
    async advance(ms) {
      if (ms < 0) throw new Error("advance must be >= 0");
      const target = now + ms;
      await fireDue(target);
      now = target;
    },
    scheduler: {
      start(everyMs, tick) {
        const job: Job = { due: now + everyMs, every: everyMs, tick, live: true };
        jobs.push(job);
        return {
          stop() {
            job.live = false;
          },
        };
      },
    },
    install() {
      setLeaseClock(clock);
      installed = true;
    },
    restore() {
      if (installed) setLeaseClock();
      installed = false;
      for (const j of jobs) j.live = false;
    },
  };
}

export async function withFakeLeaseTime<T>(fn: (time: FakeLeaseTime) => Promise<T>, startMs?: number): Promise<T> {
  const time = createFakeLeaseTime(startMs);
  time.install();
  try {
    return await fn(time);
  } finally {
    time.restore();
  }
}
