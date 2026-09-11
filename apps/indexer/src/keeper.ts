import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeFunctionData,
  encodeAbiParameters,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { defineChain } from "viem";
import deployment from "./deployment.json" with { type: "json" };

/**
 * Designated Keeper daemon.
 * Simulate → minOut → submit → receipt → reconcile. Idempotent job IDs.
 * Modes: DRY_RUN | LOCAL | ARC_TESTNET. Chain 5042 (mainnet) is hard-disabled.
 */

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const API = process.env.REACTOR_TOP10_URL ?? "http://127.0.0.1:43147/api/reactor/top10";
const HEARTBEAT = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
const STATE = process.env.KEEPER_STATE ?? new URL("../data/keeper-state.json", import.meta.url).pathname;
const INTERVAL = Number(process.env.KEEPER_INTERVAL_MS ?? 60_000);
const LOCAL_CHAIN = 5042002;
const MAINNET_CHAIN = 5042;
const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const SLIP_BPS = BigInt(process.env.KEEPER_SLIP_BPS ?? 150);
const MAX_JOBS_PER_TICK = Number(process.env.KEEPER_MAX_JOBS_PER_TICK ?? 4);
const AMBIGUOUS_COOLDOWN_MS = Number(process.env.KEEPER_AMBIGUOUS_MS ?? 10 * 60 * 1000);
const THRESHOLD = 10_000n;

type Mode = "DRY_RUN" | "LOCAL" | "ARC_TESTNET";
function resolveMode(): Mode {
  const raw = (process.env.KEEPER_MODE ?? "LOCAL").toUpperCase();
  if (raw === "DRY_RUN" || raw === "LOCAL" || raw === "ARC_TESTNET") return raw;
  throw new Error(`unknown KEEPER_MODE ${raw}`);
}
const MODE = resolveMode();

const flywheelAbi = parseAbi([
  "function epoch() view returns (uint256)",
  "function epochFinalized() view returns (bool)",
  "function usdcPot() view returns (uint256)",
  "function quoteAccrued(address) view returns (uint256)",
  "function settleQuote(address quote, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minOut)",
  "function submitEpoch(uint256 epochId, address[] targets, uint256[] weights_)",
  "function executeTop10Buyback(address token, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minTargetOut)",
  "function rollEpoch()",
  "function bought(uint256,address) view returns (bool)",
]);
const selfBurnAbi = parseAbi([
  "function accrued(address) view returns (uint256)",
  "function execute(address token, uint256 minTargetOut)",
]);
const buybackAbi = parseAbi([
  "function accrued(address) view returns (uint256)",
  "function execute(address quote, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minOut)",
]);
const factoryAbi = parseAbi([
  "function allTokensLength() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
]);
const curveAbi = parseAbi([
  "function readyOf(address) view returns (bool)",
  "function graduatedOf(address) view returns (bool)",
  "function existsOf(address) view returns (bool)",
  "function graduate(address token) returns (bytes32)",
]);

type Top10 = { pauseEpoch: boolean; reason: string; rows: Array<{ token: string; weightBps: number; symbol: string }> };
type JobState = { status: "done" | "pending" | "failed" | "ambiguous"; hash?: string; ts: number; note?: string };
type KeeperState = { jobs: Record<string, JobState> };

const addrs = deployment.addresses as Record<string, string>;
const chain = defineChain({
  id: deployment.chainId,
  name: "reactor-local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const client = createPublicClient({ chain, transport: http(RPC) });

function keeperKey(chainId: number): `0x${string}` | null {
  const env = process.env.KEEPER_PRIVATE_KEY;
  if (env) return env as `0x${string}`;
  if (chainId === LOCAL_CHAIN && MODE === "LOCAL") return ANVIL0;
  return null;
}

function loadState(): KeeperState {
  if (!existsSync(STATE)) return { jobs: {} };
  try {
    return JSON.parse(readFileSync(STATE, "utf8")) as KeeperState;
  } catch {
    return { jobs: {} };
  }
}

function saveState(s: KeeperState) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

function writeBeat(beat: Record<string, unknown>) {
  mkdirSync(dirname(HEARTBEAT), { recursive: true });
  writeFileSync(HEARTBEAT, JSON.stringify({ ...beat, mode: MODE, ts: Date.now() }, null, 2));
}

function floorMin(out: bigint): bigint {
  const v = (out * (10_000n - SLIP_BPS)) / 10_000n;
  return v === 0n ? 1n : v;
}

function poolKeyBytes(a: `0x${string}`, b: `0x${string}`): Hex {
  const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
    ],
    [
      {
        currency0: c0,
        currency1: c1,
        fee: 3000,
        tickSpacing: 60,
        hooks: "0x0000000000000000000000000000000000000000",
      },
    ],
  );
}

function quoteToUsdcHops(quote: `0x${string}`, usdc: `0x${string}`, minOut: bigint) {
  if (quote.toLowerCase() === usdc.toLowerCase()) return [];
  const adapter = (addrs.ProtocolV4Adapter ?? addrs.V4Adapter) as `0x${string}`;
  return [{ adapter, tokenIn: quote, tokenOut: usdc, minOut, data: poolKeyBytes(quote, usdc) }];
}

function canBroadcast(chainId: number): { ok: boolean; reason?: string } {
  if (chainId === MAINNET_CHAIN) return { ok: false, reason: "mainnet disabled" };
  if (MODE === "DRY_RUN") return { ok: false, reason: "DRY_RUN" };
  if (chainId !== LOCAL_CHAIN) return { ok: false, reason: `refuse chain ${chainId}` };
  return { ok: true };
}

async function submitOnce(state: KeeperState, id: string, send: () => Promise<Hex>): Promise<JobState> {
  const prev = state.jobs[id];
  if (prev?.status === "done") return prev;
  if (prev?.status === "ambiguous" && Date.now() - prev.ts < AMBIGUOUS_COOLDOWN_MS) return prev;
  if (prev?.status === "pending" && prev.hash) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: prev.hash as Hex });
      const next: JobState =
        receipt.status === "success"
          ? { status: "done", hash: prev.hash, ts: Date.now() }
          : { status: "failed", hash: prev.hash, ts: Date.now(), note: "receipt reverted" };
      state.jobs[id] = next;
      saveState(state);
      return next;
    } catch {
      state.jobs[id] = {
        status: "ambiguous",
        hash: prev.hash,
        ts: Date.now(),
        note: "rpc ambiguous — will not double-exec",
      };
      saveState(state);
      return state.jobs[id]!;
    }
  }
  if (MODE === "DRY_RUN") {
    const dry: JobState = { status: "done", ts: Date.now(), note: "DRY_RUN" };
    state.jobs[id] = dry;
    saveState(state);
    return dry;
  }
  let hash: Hex;
  try {
    hash = await send();
  } catch (e) {
    const failed: JobState = { status: "failed", ts: Date.now(), note: String(e) };
    state.jobs[id] = failed;
    saveState(state);
    return failed;
  }
  state.jobs[id] = { status: "pending", hash, ts: Date.now() };
  saveState(state);
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const next: JobState =
      receipt.status === "success"
        ? { status: "done", hash, ts: Date.now() }
        : { status: "failed", hash, ts: Date.now(), note: "receipt reverted" };
    state.jobs[id] = next;
    saveState(state);
    return next;
  } catch {
    state.jobs[id] = { status: "ambiguous", hash, ts: Date.now(), note: "no receipt — not retrying" };
    saveState(state);
    return state.jobs[id]!;
  }
}

async function tick() {
  const chainId = await client.getChainId();
  if (chainId === MAINNET_CHAIN) {
    writeBeat({ ok: false, reason: "mainnet disabled" });
    throw new Error("mainnet disabled");
  }
  const state = loadState();
  const flywheel = addrs.FlywheelVault as `0x${string}` | undefined;
  const selfBurn = addrs.SelfBurnVault as `0x${string}` | undefined;
  const buyback = addrs.BuybackVault as `0x${string}` | undefined;
  const factory = addrs.ReactorFactory as `0x${string}` | undefined;
  const curve = addrs.InstantCurve as `0x${string}` | undefined;
  const usdc = addrs.USDC as `0x${string}`;
  const zec = addrs.ZEC as `0x${string}` | undefined;
  const jobs: string[] = [];
  const block = await client.getBlockNumber();

  const res = await fetch(API);
  if (!res.ok) throw new Error(`top10 http ${res.status}`);
  const body = (await res.json()) as Top10;
  if (body.pauseEpoch) {
    writeBeat({ ok: false, pauseEpoch: true, reason: body.reason, block: block.toString(), chainId, jobs });
    return;
  }

  const gate = canBroadcast(chainId);
  const key = keeperKey(chainId);
  if (!gate.ok) {
    writeBeat({
      ok: true,
      pauseEpoch: false,
      reason: gate.reason,
      n: body.rows.length,
      block: block.toString(),
      chainId,
      submitted: false,
      jobs,
    });
    return;
  }
  if (!key) {
    writeBeat({ ok: false, reason: "no keeper key", chainId });
    return;
  }

  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  let ran = 0;
  const send = (to: `0x${string}`, data: Hex) => wallet.sendTransaction({ to, data, account, chain });
  const run = async (id: string, to: `0x${string}`, data: Hex) => {
    if (ran >= MAX_JOBS_PER_TICK) return;
    if (state.jobs[id]?.status === "done") return;
    const r = await submitOnce(state, id, () => send(to, data));
    jobs.push(`${id}:${r.status}`);
    if (r.status === "done") ran += 1;
    if (r.status === "ambiguous") {
      writeBeat({ ok: false, reason: `ambiguous rpc ${id}`, jobs, chainId, block: block.toString() });
    }
  };

  if (factory && curve && process.env.KEEPER_GRADUATE !== "0") {
    const len = Number(await client.readContract({ address: factory, abi: factoryAbi, functionName: "allTokensLength" }));
    for (let i = 0; i < len && ran < MAX_JOBS_PER_TICK; i++) {
      const token = (await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "allTokens",
        args: [BigInt(i)],
      })) as `0x${string}`;
      const exists = await client.readContract({ address: curve, abi: curveAbi, functionName: "existsOf", args: [token] });
      if (!exists) continue;
      const [ready, graduated] = await Promise.all([
        client.readContract({ address: curve, abi: curveAbi, functionName: "readyOf", args: [token] }),
        client.readContract({ address: curve, abi: curveAbi, functionName: "graduatedOf", args: [token] }),
      ]);
      if (ready && !graduated) {
        await run(
          `grad:${token.toLowerCase()}`,
          curve,
          encodeFunctionData({ abi: curveAbi, functionName: "graduate", args: [token] }),
        );
      }
      if (selfBurn) {
        const acc = (await client.readContract({
          address: selfBurn,
          abi: selfBurnAbi,
          functionName: "accrued",
          args: [token],
        })) as bigint;
        if (acc >= THRESHOLD) {
          const sim = await client
            .simulateContract({
              address: selfBurn,
              abi: selfBurnAbi,
              functionName: "execute",
              args: [token, 1n],
              account: account.address,
            })
            .catch(() => null);
          if (sim) {
            const minOut = floorMin(sim.result as bigint);
            await run(
              `selfburn:${token.toLowerCase()}:${acc.toString()}`,
              selfBurn,
              encodeFunctionData({ abi: selfBurnAbi, functionName: "execute", args: [token, minOut] }),
            );
          }
        }
      }
    }
  }

  const quotes = [usdc, zec].filter(Boolean) as `0x${string}`[];
  if (flywheel) {
    for (const q of quotes) {
      const acc = (await client.readContract({
        address: flywheel,
        abi: flywheelAbi,
        functionName: "quoteAccrued",
        args: [q],
      })) as bigint;
      if (acc < THRESHOLD) continue;
      const hops = quoteToUsdcHops(q, usdc, 1n);
      const minOut = q.toLowerCase() === usdc.toLowerCase() ? 0n : 1n;
      const sim = await client
        .simulateContract({
          address: flywheel,
          abi: flywheelAbi,
          functionName: "settleQuote",
          args: [q, hops, minOut],
          account: account.address,
        })
        .catch(() => null);
      if (!sim) continue;
      const hopMin = hops.length ? floorMin(1n) : minOut;
      const hops2 = hops.length ? quoteToUsdcHops(q, usdc, hopMin) : hops;
      await run(
        `settle:${q.toLowerCase()}:${acc.toString()}`,
        flywheel,
        encodeFunctionData({ abi: flywheelAbi, functionName: "settleQuote", args: [q, hops2, hops2.length ? hopMin : minOut] }),
      );
    }
  }

  if (buyback) {
    for (const q of quotes) {
      const acc = (await client.readContract({
        address: buyback,
        abi: buybackAbi,
        functionName: "accrued",
        args: [q],
      })) as bigint;
      if (acc < THRESHOLD) continue;
      const hops = quoteToUsdcHops(q, usdc, 1n);
      const sim = await client
        .simulateContract({
          address: buyback,
          abi: buybackAbi,
          functionName: "execute",
          args: [q, hops, 1n],
          account: account.address,
        })
        .catch(() => null);
      if (!sim) continue;
      const minOut = floorMin(sim.result as bigint);
      const hops2 = hops.length ? quoteToUsdcHops(q, usdc, minOut) : hops;
      await run(
        `core:${q.toLowerCase()}:${acc.toString()}`,
        buyback,
        encodeFunctionData({ abi: buybackAbi, functionName: "execute", args: [q, hops2, minOut] }),
      );
    }
  }

  let submitted = false;
  if (flywheel && body.rows.length > 0) {
    const weightSum = body.rows.reduce((s, r) => s + r.weightBps, 0);
    if (weightSum !== 10_000) {
      writeBeat({ ok: false, pauseEpoch: true, reason: `weights ${weightSum} != 10000` });
      return;
    }
    const [epoch, finalized] = await Promise.all([
      client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "epoch" }),
      client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "epochFinalized" }),
    ]);
    if (!finalized) {
      const data = encodeFunctionData({
        abi: flywheelAbi,
        functionName: "submitEpoch",
        args: [epoch, body.rows.map((r) => r.token as `0x${string}`), body.rows.map((r) => BigInt(r.weightBps))],
      });
      const r = await submitOnce(
        state,
        `epoch:${epoch.toString()}:${body.rows.map((x) => x.token).join(",")}`,
        () => send(flywheel, data),
      );
      jobs.push(`epoch:${r.status}`);
      submitted = r.status === "done";
      if (r.status === "ambiguous") {
        writeBeat({ ok: false, reason: "ambiguous epoch submit — not retrying", jobs, epoch: epoch.toString() });
        return;
      }
    } else {
      for (const row of body.rows) {
        const bought = await client.readContract({
          address: flywheel,
          abi: flywheelAbi,
          functionName: "bought",
          args: [epoch, row.token as `0x${string}`],
        });
        if (bought) continue;
        const hops: never[] = [];
        const sim = await client
          .simulateContract({
            address: flywheel,
            abi: flywheelAbi,
            functionName: "executeTop10Buyback",
            args: [row.token as `0x${string}`, hops, 1n],
            account: account.address,
          })
          .catch(() => null);
        if (!sim) continue;
        const minOut = floorMin(sim.result as bigint);
        await run(
          `top10:${epoch.toString()}:${row.token.toLowerCase()}`,
          flywheel,
          encodeFunctionData({
            abi: flywheelAbi,
            functionName: "executeTop10Buyback",
            args: [row.token as `0x${string}`, hops, minOut],
          }),
        );
      }
      const pot = (await client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "usdcPot" })) as bigint;
      const allBought = await Promise.all(
        body.rows.map((r) =>
          client.readContract({
            address: flywheel,
            abi: flywheelAbi,
            functionName: "bought",
            args: [epoch, r.token as `0x${string}`],
          }),
        ),
      );
      if (allBought.every(Boolean) || pot === 0n) {
        await run(`roll:${epoch.toString()}`, flywheel, encodeFunctionData({ abi: flywheelAbi, functionName: "rollEpoch" }));
      }
    }
  }

  writeBeat({
    ok: true,
    pauseEpoch: false,
    reason: "tick ok",
    n: body.rows.length,
    tokens: body.rows.map((r) => r.token),
    weights: body.rows.map((r) => r.weightBps),
    block: block.toString(),
    chainId,
    submitted,
    jobs,
  });
}

async function loop() {
  try {
    await tick();
  } catch (e) {
    console.error("keeper tick failed (fail closed)", e);
    writeBeat({ ok: false, pauseEpoch: true, submitted: false, reason: String(e) });
  }
  if (process.env.KEEPER_ONCE === "1") return;
  setTimeout(loop, INTERVAL);
}

console.log(`keeper daemon mode=${MODE} → ${API} heartbeat ${HEARTBEAT}`);
loop();
