import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { defineChain } from "viem";
import deployment from "./deployment.json" with { type: "json" };

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const API = process.env.REACTOR_TOP10_URL ?? "http://127.0.0.1:43147/api/reactor/top10";
const HEARTBEAT = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
const INTERVAL = Number(process.env.KEEPER_INTERVAL_MS ?? 60_000);
const LOCAL_CHAIN = 5042002;
const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const flywheelAbi = parseAbi([
  "function epoch() view returns (uint256)",
  "function epochFinalized() view returns (bool)",
  "function submitEpoch(uint256 epochId, address[] targets, uint256[] weights_)",
]);

const chain = defineChain({
  id: deployment.chainId,
  name: "reactor-local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const client = createPublicClient({ chain, transport: http(RPC) });

type Top10 = {
  pauseEpoch: boolean;
  reason: string;
  rows: Array<{ token: string; weightBps: number; symbol: string }>;
};

function keeperKey(chainId: number): `0x${string}` | null {
  const env = process.env.KEEPER_PRIVATE_KEY;
  if (env) return env as `0x${string}`;
  if (chainId === LOCAL_CHAIN) return ANVIL0;
  return null;
}

function writeBeat(beat: Record<string, unknown>) {
  mkdirSync(dirname(HEARTBEAT), { recursive: true });
  writeFileSync(HEARTBEAT, JSON.stringify(beat, null, 2));
}

async function tick() {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`top10 http ${res.status}`);
  const body = (await res.json()) as Top10;
  const block = await client.getBlockNumber();
  const chainId = await client.getChainId();
  const flywheel = (deployment.addresses as { FlywheelVault?: string }).FlywheelVault as `0x${string}` | undefined;

  const beat: Record<string, unknown> = {
    ok: !body.pauseEpoch,
    pauseEpoch: body.pauseEpoch,
    reason: body.reason,
    n: body.rows.length,
    tokens: body.rows.map((r) => r.token),
    weights: body.rows.map((r) => r.weightBps),
    block: block.toString(),
    chainId,
    submitted: false,
    ts: Date.now(),
  };

  if (body.pauseEpoch) {
    writeBeat({ ...beat, ok: false });
    console.warn("keeper skip epoch", body.reason);
    return;
  }
  if (body.rows.length === 0) {
    writeBeat({ ...beat, reason: "no qualifying names" });
    console.log("keeper idle — no qualifying names");
    return;
  }

  const weightSum = body.rows.reduce((s, r) => s + r.weightBps, 0);
  if (weightSum !== 10_000) {
    writeBeat({ ...beat, ok: false, pauseEpoch: true, reason: `weights ${weightSum} != 10000` });
    console.error("keeper fail closed — weights must sum to 10000");
    return;
  }

  if (!flywheel) {
    writeBeat({ ...beat, ok: false, reason: "no FlywheelVault" });
    console.error("keeper fail closed — FlywheelVault missing");
    return;
  }

  const [epoch, finalized] = await Promise.all([
    client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "epoch" }),
    client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "epochFinalized" }),
  ]);
  beat.epoch = epoch.toString();

  if (finalized) {
    writeBeat({ ...beat, reason: "epoch already finalized" });
    console.log("keeper idle — epoch already finalized", epoch.toString());
    return;
  }

  if (chainId !== LOCAL_CHAIN) {
    writeBeat({ ...beat, ok: false, reason: `refuse broadcast on chain ${chainId}` });
    console.warn("keeper refuse broadcast — not local Anvil 5042002");
    return;
  }

  const key = keeperKey(chainId);
  if (!key) {
    writeBeat({ ...beat, ok: false, reason: "no keeper key" });
    console.error("keeper fail closed — no key");
    return;
  }

  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  const hash = await wallet.writeContract({
    address: flywheel,
    abi: flywheelAbi,
    functionName: "submitEpoch",
    args: [
      epoch,
      body.rows.map((r) => r.token as `0x${string}`),
      body.rows.map((r) => BigInt(r.weightBps)),
    ],
    account,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    writeBeat({ ...beat, ok: false, reason: `submitEpoch reverted ${hash}` });
    throw new Error(`submitEpoch failed ${hash}`);
  }
  writeBeat({ ...beat, submitted: true, txHash: hash, ok: true });
  console.log(
    "keeper submitEpoch",
    body.rows.map((r) => `${r.symbol}:${r.weightBps}`).join(","),
    "epoch",
    epoch.toString(),
    hash,
  );
}

async function loop() {
  try {
    await tick();
  } catch (e) {
    console.error("keeper tick failed (fail closed)", e);
    writeBeat({ ok: false, pauseEpoch: true, submitted: false, reason: String(e), ts: Date.now() });
  }
  if (process.env.KEEPER_ONCE === "1") return;
  setTimeout(loop, INTERVAL);
}

console.log(`keeper daemon → ${API} heartbeat ${HEARTBEAT}`);
loop();
