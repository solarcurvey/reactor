import { createPublicClient, http } from "viem";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import deployment from "./deployment.json" with { type: "json" };

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const API = process.env.REACTOR_TOP10_URL ?? "http://127.0.0.1:43147/api/reactor/top10";
const HEARTBEAT = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
const INTERVAL = Number(process.env.KEEPER_INTERVAL_MS ?? 60_000);

const client = createPublicClient({ transport: http(RPC) });

type Top10 = {
  pauseEpoch: boolean;
  reason: string;
  rows: Array<{ token: string; weightBps: number; symbol: string }>;
};

async function tick() {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`top10 http ${res.status}`);
  const body = (await res.json()) as Top10;
  const block = await client.getBlockNumber();
  const beat = {
    ok: !body.pauseEpoch,
    pauseEpoch: body.pauseEpoch,
    reason: body.reason,
    n: body.rows.length,
    tokens: body.rows.map((r) => r.token),
    weights: body.rows.map((r) => r.weightBps),
    block: block.toString(),
    ts: Date.now(),
  };
  mkdirSync(dirname(HEARTBEAT), { recursive: true });
  writeFileSync(HEARTBEAT, JSON.stringify(beat, null, 2));
  if (body.pauseEpoch) {
    console.warn("keeper skip epoch", body.reason);
    return;
  }
  if (body.rows.length === 0) {
    console.log("keeper idle — no qualifying names");
    return;
  }
  console.log(
    "keeper would submitEpoch",
    body.rows.map((r) => `${r.symbol}:${r.weightBps}`).join(","),
    "block",
    block.toString(),
  );
}

async function loop() {
  try {
    await tick();
  } catch (e) {
    console.error("keeper tick failed (fail closed)", e);
    mkdirSync(dirname(HEARTBEAT), { recursive: true });
    writeFileSync(
      HEARTBEAT,
      JSON.stringify({ ok: false, pauseEpoch: true, reason: String(e), ts: Date.now() }, null, 2),
    );
  }
  setTimeout(loop, INTERVAL);
}

console.log(`keeper daemon → ${API} heartbeat ${HEARTBEAT}`);
loop();
