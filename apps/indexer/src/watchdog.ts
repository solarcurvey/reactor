import { readFileSync, existsSync } from "node:fs";

const HEARTBEAT = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
const STALE_MS = Number(process.env.WATCHDOG_STALE_MS ?? 5 * 60 * 1000);
const INTERVAL = Number(process.env.WATCHDOG_INTERVAL_MS ?? 30_000);

function check() {
  if (!existsSync(HEARTBEAT)) {
    console.error("watchdog FAIL closed — no keeper heartbeat");
    return false;
  }
  const beat = JSON.parse(readFileSync(HEARTBEAT, "utf8")) as {
    ok?: boolean;
    pauseEpoch?: boolean;
    ts?: number;
    reason?: string;
  };
  const age = Date.now() - Number(beat.ts ?? 0);
  if (!beat.ts || age > STALE_MS) {
    console.error("watchdog FAIL closed — stale heartbeat", age);
    return false;
  }
  if (beat.pauseEpoch || beat.ok === false) {
    console.warn("watchdog: epoch paused / keeper fail-closed", beat.reason);
    return false;
  }
  console.log("watchdog ok", { ageMs: age });
  return true;
}

function loop() {
  check();
  setTimeout(loop, INTERVAL);
}

console.log(`watchdog independent of keeper; heartbeat ${HEARTBEAT}`);
loop();
