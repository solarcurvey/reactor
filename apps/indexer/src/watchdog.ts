import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { defineChain } from "viem";
import deployment from "./deployment.json" with { type: "json" };

const HEARTBEAT = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
const STALE_MS = Number(process.env.WATCHDOG_STALE_MS ?? 5 * 60 * 1000);
const INTERVAL = Number(process.env.WATCHDOG_INTERVAL_MS ?? 30_000);
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;

const flywheelAbi = parseAbi([
  "function epoch() view returns (uint256)",
  "function epochFinalized() view returns (bool)",
]);

const chain = defineChain({
  id: deployment.chainId,
  name: "reactor-local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const client = createPublicClient({ chain, transport: http(RPC) });

type Beat = {
  ok?: boolean;
  pauseEpoch?: boolean;
  submitted?: boolean;
  txHash?: string;
  epoch?: string;
  ts?: number;
  reason?: string;
  n?: number;
};

async function check(): Promise<boolean> {
  if (!existsSync(HEARTBEAT)) {
    console.error("watchdog FAIL closed — no keeper heartbeat");
    return false;
  }
  const beat = JSON.parse(readFileSync(HEARTBEAT, "utf8")) as Beat;
  const age = Date.now() - Number(beat.ts ?? 0);
  if (!beat.ts || age > STALE_MS) {
    console.error("watchdog FAIL closed — stale heartbeat", age);
    return false;
  }
  if (beat.pauseEpoch || beat.ok === false) {
    console.warn("watchdog: epoch paused / keeper fail-closed", beat.reason);
    return false;
  }

  const flywheel = (deployment.addresses as { FlywheelVault?: string }).FlywheelVault as `0x${string}` | undefined;
  if (!flywheel) {
    console.error("watchdog FAIL closed — no FlywheelVault");
    return false;
  }

  const [epoch, finalized] = await Promise.all([
    client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "epoch" }),
    client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "epochFinalized" }),
  ]);

  if (beat.submitted) {
    if (!finalized) {
      console.error("watchdog FAIL closed — heartbeat submitted but epoch not finalized");
      return false;
    }
    if (beat.epoch && beat.epoch !== epoch.toString()) {
      console.error("watchdog FAIL closed — epoch mismatch", beat.epoch, epoch.toString());
      return false;
    }
  } else if (beat.n && beat.n > 0 && !beat.pauseEpoch) {
    // Confidence was OK; keeper should have submitted or found the epoch already finalized.
    if (!finalized) {
      console.error("watchdog FAIL closed — qualifying names, no submit, epoch open");
      return false;
    }
  }

  console.log("watchdog ok", { ageMs: age, epoch: epoch.toString(), finalized, submitted: !!beat.submitted });
  return true;
}

async function loop() {
  try {
    await check();
  } catch (e) {
    console.error("watchdog FAIL closed — chain read", e);
  }
  if (process.env.WATCHDOG_ONCE === "1") return;
  setTimeout(loop, INTERVAL);
}

console.log(`watchdog independent of keeper; heartbeat ${HEARTBEAT}`);
loop();
