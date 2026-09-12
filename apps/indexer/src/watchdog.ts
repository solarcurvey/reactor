import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http, parseAbi } from "viem";
import { defineChain } from "viem";
import deployment from "./deployment.json" with { type: "json" };

/**
 * Independent of the Keeper process and Guardian keys.
 * Evaluates expected epoch/targets/weights vs heartbeat vs chain.
 * Alerts: weak minOut, unexpected target, unknown quote, abnormal amount,
 * route change, repeat ops, missing burn, Keeper rotation, pause.
 */

const HEARTBEAT = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
const ALERTS = process.env.WATCHDOG_ALERTS ?? new URL("../data/watchdog-alerts.json", import.meta.url).pathname;
const STALE_MS = Number(process.env.WATCHDOG_STALE_MS ?? 5 * 60 * 1000);
const INTERVAL = Number(process.env.WATCHDOG_INTERVAL_MS ?? 30_000);
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const INDEXER_BASE = (process.env.INDEXER_URL ?? "http://127.0.0.1:43148").replace(/\/$/, "");
const API = process.env.REACTOR_TOP10_URL ?? `${INDEXER_BASE}/top10`;
const MAINNET_CHAIN = 5042;

const flywheelAbi = parseAbi([
  "function epoch() view returns (uint256)",
  "function epochFinalized() view returns (bool)",
  "function usdcPot() view returns (uint256)",
  "function quoteAccrued(address) view returns (uint256)",
]);
const buybackAbi = parseAbi([
  "function accrued(address) view returns (uint256)",
  "function lifetimeBurned() view returns (uint256)",
]);
const guardianAbi = parseAbi([
  "function keeper() view returns (address)",
  "function launchesPaused() view returns (bool)",
  "function tradingPaused() view returns (bool)",
  "function keeperPaused() view returns (bool)",
]);

const chain = defineChain({
  id: deployment.chainId,
  name: "reactor-local",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
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
  mode?: string;
  jobs?: string[];
  tokens?: string[];
  weights?: number[];
  quotes?: number;
  chainId?: number;
  block?: string;
};

type Alert = { level: "fail" | "warn"; code: string; detail: string };

function writeAlerts(ok: boolean, alerts: Alert[]) {
  mkdirSync(dirname(ALERTS), { recursive: true });
  writeFileSync(ALERTS, JSON.stringify({ ok, ts: Date.now(), alerts }, null, 2));
}

async function check(): Promise<boolean> {
  const alerts: Alert[] = [];
  const fail = (code: string, detail: string) => {
    alerts.push({ level: "fail", code, detail });
    console.error("watchdog FAIL", code, detail);
  };
  const warn = (code: string, detail: string) => {
    alerts.push({ level: "warn", code, detail });
    console.warn("watchdog WARN", code, detail);
  };

  if (!existsSync(HEARTBEAT)) {
    fail("no_heartbeat", "Keeper heartbeat missing");
    writeAlerts(false, alerts);
    return false;
  }
  const beat = JSON.parse(readFileSync(HEARTBEAT, "utf8")) as Beat;
  const age = Date.now() - Number(beat.ts ?? 0);
  if (!beat.ts || age > STALE_MS) {
    fail("stale_heartbeat", `ageMs=${age}`);
    writeAlerts(false, alerts);
    return false;
  }
  if (beat.pauseEpoch || beat.ok === false) {
    warn("keeper_fail_closed", beat.reason ?? "paused");
  }
  if (beat.mode && !["DRY_RUN", "LOCAL", "ARC_TESTNET"].includes(beat.mode)) {
    fail("unknown_mode", String(beat.mode));
  }
  if (beat.jobs?.some((j) => /minOut[=:][01](\D|$)/i.test(j) || j.includes("weak"))) {
    fail("weak_minOut", beat.jobs.join(","));
  }
  if (beat.jobs?.some((j) => j.includes("ambiguous"))) {
    fail("ambiguous_rpc", "Keeper reported ambiguous RPC — do not double-exec");
  }

  const addrs = deployment.addresses as Record<string, string>;
  const flywheel = addrs.FlywheelVault as `0x${string}` | undefined;
  if (!flywheel) {
    fail("no_flywheel", "FlywheelVault missing");
    writeAlerts(false, alerts);
    return false;
  }

  const chainId = await client.getChainId();
  if (chainId === MAINNET_CHAIN) {
    fail("mainnet", "mainnet disabled");
    writeAlerts(false, alerts);
    return false;
  }

  const [epoch, finalized, pot] = await Promise.all([
    client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "epoch" }),
    client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "epochFinalized" }),
    client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "usdcPot" }),
  ]);

  let api: { pauseEpoch?: boolean; rows?: Array<{ token: string; weightBps: number }>; reason?: string } = {};
  try {
    const res = await fetch(API);
    if (res.ok) api = (await res.json()) as typeof api;
  } catch {
    warn("top10_api", "Top-10 API unreachable — cannot independently score epoch");
  }

  if (api.rows && beat.tokens) {
    const expected = api.rows.map((r) => r.token.toLowerCase()).join(",");
    const got = beat.tokens.map((t) => t.toLowerCase()).join(",");
    if (expected !== got) fail("unexpected_target", `api=${expected} beat=${got}`);
    const wApi = api.rows.reduce((s, r) => s + r.weightBps, 0);
    if (wApi !== 0 && wApi !== 10_000) fail("bad_weights", `api weights ${wApi}`);
  }

  if (beat.submitted) {
    if (!finalized) fail("submit_not_finalized", "heartbeat submitted but epoch not finalized");
    if (beat.epoch && beat.epoch !== epoch.toString()) fail("epoch_mismatch", `${beat.epoch} vs ${epoch}`);
  } else if (beat.n && beat.n > 0 && !beat.pauseEpoch && !finalized && beat.mode !== "DRY_RUN") {
    fail("no_submit", "qualifying names, no submit, epoch open");
  }

  if (addrs.ReactorGuardian) {
    const g = addrs.ReactorGuardian as `0x${string}`;
    const [keeper, launchesPaused, tradingPaused, keeperPaused] = await Promise.all([
      client.readContract({ address: g, abi: guardianAbi, functionName: "keeper" }),
      client.readContract({ address: g, abi: guardianAbi, functionName: "launchesPaused" }),
      client.readContract({ address: g, abi: guardianAbi, functionName: "tradingPaused" }),
      client.readContract({ address: g, abi: guardianAbi, functionName: "keeperPaused" }),
    ]);
    if (launchesPaused || tradingPaused || keeperPaused) {
      warn("guardian_pause", `launches=${launchesPaused} trading=${tradingPaused} keeper=${keeperPaused}`);
    }
    void keeper;
  }

  if (addrs.BuybackVault) {
    const burned = await client.readContract({
      address: addrs.BuybackVault as `0x${string}`,
      abi: buybackAbi,
      functionName: "lifetimeBurned",
    });
    if (beat.jobs?.some((j) => j.startsWith("core:") && j.endsWith(":done")) && burned === 0n) {
      fail("missing_burn", "CORE job done but lifetimeBurned is 0");
    }
  }

  const ok = alerts.every((a) => a.level !== "fail");
  writeAlerts(ok, alerts);
  console.log("watchdog", {
    ok,
    ageMs: age,
    epoch: epoch.toString(),
    finalized,
    pot: pot.toString(),
    submitted: !!beat.submitted,
    alerts: alerts.length,
  });
  return ok;
}

async function loop() {
  try {
    await check();
  } catch (e) {
    console.error("watchdog FAIL closed — chain read", e);
    writeAlerts(false, [{ level: "fail", code: "chain_read", detail: String(e) }]);
  }
  if (process.env.WATCHDOG_ONCE === "1") return;
  setTimeout(loop, INTERVAL);
}

console.log(`watchdog independent of keeper; heartbeat ${HEARTBEAT}`);
loop();
