/**
 * Lease wall clock + renew scheduler.
 *
 * Production: `Date.now()` and `setInterval`. Tests inject a fake clock so TTL /
 * renew / steal cases do not race the event loop (CI flake after #47:
 * "renewed leader still holds after work > TTL").
 *
 * Does not change acquire / renew / fence SQL semantics.
 */

export type LeaseClock = {
  now(): number;
};

export type LeaseRenewHandle = {
  stop(): void;
};

export type LeaseRenewScheduler = {
  start(everyMs: number, tick: () => Promise<void>): LeaseRenewHandle;
};

export function wallLeaseClock(): LeaseClock {
  return { now: () => Date.now() };
}

export function wallLeaseRenewScheduler(): LeaseRenewScheduler {
  return {
    start(everyMs, tick) {
      const id = setInterval(() => {
        void tick();
      }, everyMs);
      return { stop: () => clearInterval(id) };
    },
  };
}

let clock: LeaseClock = wallLeaseClock();

export function leaseNow(): number {
  return clock.now();
}

/** Test-only. Pass `undefined` to restore `Date.now()`. */
export function setLeaseClock(next?: LeaseClock) {
  clock = next ?? wallLeaseClock();
}
