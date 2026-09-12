import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeFunctionData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { defineChain } from "viem";
import { hostname } from "node:os";
import deployment from "./deployment.json" with { type: "json" };
import { type QuoteMeta, type Hop } from "../../../packages/reactor/src/routes.ts";
import { openStore, type Store } from "./db.ts";
import {
  assertKeySeparation,
  saveJob,
  withLeaderLock,
  withBroadcastFence,
  LeaderLeaseLostError,
  type LeaderLease,
} from "./keeper-jobs.ts";
import { planFeeExemptRoute, syncOfficialFactoryVenues } from "./route-graph.ts";
import { acceptTop10Snapshot } from "../../../packages/reactor/src/top10.ts";

/**
 * Designated Keeper daemon.
 * Simulate with safe params → read returned expected output → conservative minOut → submit → verify.
 * Modes: DRY_RUN | LOCAL | ARC_TESTNET. Chain 5042 (mainnet) is hard-disabled.
 * Never logs private keys. Never submits minOut 0 or 1.
 */

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const INDEXER_BASE = (process.env.INDEXER_URL ?? "http://127.0.0.1:43148").replace(/\/$/, "");
const API = process.env.REACTOR_TOP10_URL ?? `${INDEXER_BASE}/top10`;
const HEARTBEAT = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
const STATE = process.env.KEEPER_STATE ?? new URL("../data/keeper-state.json", import.meta.url).pathname;
const OWNER = `${hostname()}:${process.pid}`;
let jobStore: Store | undefined;
let activeLease: LeaderLease | undefined;
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

const hopTuple =
  "(address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[]";

const flywheelAbi = parseAbi([
  "function epoch() view returns (uint256)",
  "function epochFinalized() view returns (bool)",
  "function usdcPot() view returns (uint256)",
  "function quoteAccrued(address) view returns (uint256)",
  `function settleQuote(address quote, ${hopTuple} hops, uint256 minOut) returns (uint256 usdcReceived)`,
  `function previewSettleQuote(address quote, ${hopTuple} hops)`,
  `function previewTop10Hops(address token, ${hopTuple} hops)`,
  "error PreviewHops(uint256[] hopOuts, uint256 finalOut)",
  "function submitEpoch(uint256 epochId, address[] targets, uint256[] weights_)",
  `function executeTop10Buyback(address token, ${hopTuple} hops, uint256 minTargetOut) returns (uint256 targetBought)`,
  "function rollEpoch()",
  "function bought(uint256,address) view returns (bool)",
  "function ranked(uint256) view returns (address)",
  "function weights(uint256) view returns (uint256)",
]);

/** Execute FROZEN onchain epoch members. Never re-query a later API set mid-epoch. */
export function frozenEpochTargets(
  onchain: Array<{ token: string; weightBps: number }>,
  latestApi: Array<{ token: string; weightBps: number }>,
): Array<{ token: string; weightBps: number }> {
  if (onchain.length === 0) return [];
  const frozen = onchain.filter((r) => r.token && r.token !== "0x0000000000000000000000000000000000000000");
  const apiSet = new Set(latestApi.map((r) => r.token.toLowerCase()));
  const drifted = frozen.some((r) => !apiSet.has(r.token.toLowerCase()));
  if (drifted) {
    /* keep frozen A/B/C even if API now says A/D/E */
  }
  return frozen;
}
const selfBurnAbi = parseAbi([
  "function accrued(address) view returns (uint256)",
  "function quoteOf(address) view returns (address)",
  "function execute(address token, uint256 minTargetOut) returns (uint256 burnedAmount)",
]);
const buybackAbi = parseAbi([
  "function accrued(address) view returns (uint256)",
  `function execute(address quote, ${hopTuple} hops, uint256 minOut) returns (uint256 coreBought)`,
  `function previewExecuteHops(address quote, ${hopTuple} hops)`,
  "error PreviewHops(uint256[] hopOuts, uint256 finalOut)",
]);
const factoryAbi = parseAbi([
  "function allTokensLength() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function tokenInfo(address) view returns (address token, address quote, address creator, uint8 mode, bytes32 poolId, bool marketLive, uint256 fairId)",
]);
const curveAbi = parseAbi([
  "function readyOf(address) view returns (bool)",
  "function graduatedOf(address) view returns (bool)",
  "function existsOf(address) view returns (bool)",
  "function graduate(address token) returns (bytes32)",
]);
const registryAbi = parseAbi([
  "function count() view returns (uint256)",
  "function list(uint256) view returns (address)",
  "function usdc() view returns (address)",
  "function get(address) view returns (address token, string symbol, string name, uint8 decimals, string icon, uint8 category, bool enabled, bool exists, bool rewardsEnabled, bool buybackRouteEnabled, bool hopViaUsdc, bool reactorNative, bool usdPegOne)",
]);
const hookAbi = parseAbi([
  "function marketOfToken(address) view returns (address token, address quote, bool exists)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

type Top10 = {
  pauseEpoch: boolean;
  reason: string;
  computedTs?: number;
  rows: Array<{ token: string; weightBps: number; symbol: string; quote?: string }>;
};
type JobState = {
  status: "done" | "pending" | "failed" | "ambiguous";
  hash?: string;
  nonce?: string;
  receipt?: string;
  ts: number;
  note?: string;
};
type KeeperState = { jobs: Record<string, JobState> };

const addrs = deployment.addresses as Record<string, string>;
const chain = defineChain({
  id: deployment.chainId,
  name: "reactor-local",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const client = createPublicClient({ chain, transport: http(RPC) });

function keeperKey(chainId: number): `0x${string}` | null {
  const env = process.env.KEEPER_PRIVATE_KEY;
  if (env) {
    if (env.length < 10) throw new Error("KEEPER_PRIVATE_KEY malformed");
    assertKeySeparation({ keeper: env, pricing: process.env.PRICING_SIGNER_PK, guardian: process.env.GUARDIAN_PK });
    return env as `0x${string}`;
  }
  if (chainId === LOCAL_CHAIN && MODE === "LOCAL" && (process.env.REACTOR_ENV ?? "LOCAL").toUpperCase() === "LOCAL") return ANVIL0;
  if (chainId === LOCAL_CHAIN && MODE === "ARC_TESTNET") return null;
  return null;
}

async function loadState(): Promise<KeeperState> {
  if (jobStore) {
    const rows = await jobStore.all<{ id: string; status: string; hash: string; nonce: string; receipt: string; note: string; ts: number }>(
      "SELECT id,status,hash,nonce,receipt,note,ts FROM keeper_operations",
    );
    const jobs: Record<string, JobState> = {};
    for (const r of rows) {
      jobs[r.id] = { status: r.status as JobState["status"], hash: r.hash, nonce: r.nonce, receipt: r.receipt, note: r.note, ts: Number(r.ts) };
    }
    return { jobs };
  }
  if (!existsSync(STATE)) return { jobs: {} };
  try {
    return JSON.parse(readFileSync(STATE, "utf8")) as KeeperState;
  } catch {
    return { jobs: {} };
  }
}

function jobKind(id: string): string {
  if (id.startsWith("settle:")) return "MAINTENANCE_SETTLEMENT";
  if (id.startsWith("top10:")) return "TOP10_BUY";
  if (id.startsWith("selfburn:")) return "SELFBURN";
  if (id.startsWith("core:")) return "CORE_BUYBACK";
  if (id.startsWith("grad:")) return "GRADUATE";
  if (id.startsWith("epoch:")) return "EPOCH_SUBMIT";
  if (id.startsWith("roll:")) return "EPOCH_ROLL";
  return "keeper";
}

async function saveState(s: KeeperState) {
  if (jobStore) {
    for (const [id, job] of Object.entries(s.jobs)) await saveJob(jobStore, id, job, jobKind(id));
    return;
  }
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

function writeBeat(beat: Record<string, unknown>) {
  mkdirSync(dirname(HEARTBEAT), { recursive: true });
  writeFileSync(HEARTBEAT, JSON.stringify({ ...beat, mode: MODE, ts: Date.now() }, null, 2));
}

export function conservativeMinOut(simOut: bigint, slipBps = SLIP_BPS): bigint {
  if (simOut === undefined || simOut === null) throw new Error("void sim result");
  const v = (simOut * (10_000n - slipBps)) / 10_000n;
  if (v <= 1n) throw new Error(`weak minOut from sim ${simOut}`);
  return v;
}

function canBroadcast(chainId: number): { ok: boolean; reason?: string } {
  if (chainId === MAINNET_CHAIN) return { ok: false, reason: "mainnet disabled" };
  if (MODE === "DRY_RUN") return { ok: false, reason: "DRY_RUN" };
  if (chainId !== LOCAL_CHAIN) return { ok: false, reason: `refuse chain ${chainId}` };
  if (MODE === "ARC_TESTNET" || MODE === "LOCAL") return { ok: true };
  return { ok: false, reason: "mode" };
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
          ? { status: "done", hash: prev.hash, nonce: prev.nonce, receipt: receipt.status, ts: Date.now() }
          : { status: "failed", hash: prev.hash, nonce: prev.nonce, receipt: receipt.status, ts: Date.now(), note: "receipt reverted" };
      state.jobs[id] = next;
      await saveState(state);
      return next;
    } catch {
      state.jobs[id] = {
        status: "ambiguous",
        hash: prev.hash,
        nonce: prev.nonce,
        ts: Date.now(),
        note: "rpc ambiguous — will not double-exec",
      };
      await saveState(state);
      return state.jobs[id]!;
    }
  }
  if (MODE === "DRY_RUN") {
    const dry: JobState = { status: "done", ts: Date.now(), note: "DRY_RUN" };
    state.jobs[id] = dry;
    await saveState(state);
    return dry;
  }
  let hash: Hex;
  try {
    hash =
      jobStore && activeLease
        ? await withBroadcastFence(jobStore, activeLease, send)
        : await send();
  } catch (e) {
    if (e instanceof LeaderLeaseLostError) throw e;
    const failed: JobState = { status: "failed", ts: Date.now(), note: String(e) };
    state.jobs[id] = failed;
    await saveState(state);
    return failed;
  }
  state.jobs[id] = { status: "pending", hash, ts: Date.now() };
  await saveState(state);
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const next: JobState =
      receipt.status === "success"
        ? { status: "done", hash, receipt: receipt.status, ts: Date.now() }
        : { status: "failed", hash, receipt: receipt.status, ts: Date.now(), note: "receipt reverted" };
    state.jobs[id] = next;
    await saveState(state);
    return next;
  } catch {
    state.jobs[id] = { status: "ambiguous", hash, ts: Date.now(), note: "no receipt — not retrying" };
    await saveState(state);
    return state.jobs[id]!;
  }
}

async function discoverQuotes(): Promise<{
  quotes: `0x${string}`[];
  metas: Map<string, QuoteMeta>;
  usdc: `0x${string}`;
}> {
  const registry = addrs.QuoteAssetRegistry as `0x${string}` | undefined;
  const usdc = (addrs.USDC as `0x${string}`) ?? "0x0000000000000000000000000000000000000000";
  const metas = new Map<string, QuoteMeta>();
  const quotes: `0x${string}`[] = [];
  if (registry) {
    const n = Number(await client.readContract({ address: registry, abi: registryAbi, functionName: "count" }));
    for (let i = 0; i < n; i++) {
      const token = (await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "list",
        args: [BigInt(i)],
      })) as `0x${string}`;
      const g = (await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "get",
        args: [token],
      })) as readonly unknown[];
      const enabled = Boolean(g[6]);
      const exists = Boolean(g[7]);
      metas.set(token.toLowerCase(), {
        token,
        symbol: String(g[1]),
        enabled,
        quarantined: exists && !enabled,
        usdPegOne: Boolean(g[12]),
        reactorNative: Boolean(g[11]),
        hopViaUsdc: Boolean(g[10]),
      });
      if (exists) quotes.push(token);
    }
  }
  if (!quotes.some((q) => q.toLowerCase() === usdc.toLowerCase())) quotes.push(usdc);
  const factory = addrs.ReactorFactory as `0x${string}` | undefined;
  if (factory) {
    const len = Number(await client.readContract({ address: factory, abi: factoryAbi, functionName: "allTokensLength" }));
    for (let i = 0; i < len; i++) {
      const token = (await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "allTokens",
        args: [BigInt(i)],
      })) as `0x${string}`;
      const info = (await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "tokenInfo",
        args: [token],
      })) as readonly unknown[];
      const quote = String(info[1]) as `0x${string}`;
      if (quote && !quotes.some((q) => q.toLowerCase() === quote.toLowerCase())) quotes.push(quote);
    }
  }
  return { quotes, metas, usdc };
}

async function syncLiveOfficialVenues() {
  if (!jobStore) return;
  const protocol = (addrs.ProtocolV4Adapter ?? addrs.V4Adapter) as `0x${string}` | undefined;
  const user = (addrs.V4Adapter ?? addrs.UniswapV4Adapter) as `0x${string}` | undefined;
  const hook = (addrs.ReactorHook ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const factory = addrs.ReactorFactory as `0x${string}` | undefined;
  if (!protocol || !factory) return;
  const venues: Array<{ token: string; quote: string; protocol: string; user?: string; hook: string; poolId?: string }> = [];
  const len = Number(await client.readContract({ address: factory, abi: factoryAbi, functionName: "allTokensLength" }));
  for (let i = 0; i < len; i++) {
    const token = (await client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "allTokens",
      args: [BigInt(i)],
    })) as `0x${string}`;
    const info = (await client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "tokenInfo",
      args: [token],
    })) as readonly unknown[];
    const quote = String(info[1]);
    const live = Boolean(info[5]);
    if (!live) continue;
    venues.push({
      token,
      quote,
      protocol,
      user,
      hook,
      poolId: String(info[4] ?? ""),
    });
  }
  await syncOfficialFactoryVenues(jobStore, venues);
}

async function hopsOrEmpty(tokenIn: `0x${string}`, tokenOut: `0x${string}`, adapters: Set<string>): Promise<Hop[]> {
  if (!jobStore) throw new Error("keeper RouteGraph store required");
  const planned = await planFeeExemptRoute(jobStore, tokenIn, tokenOut, adapters);
  return planned.hops.map((h) => ({ ...h, minOut: 1n }));
}

/** One simulated out per hop. Never reuse last-leg as an intermediate floor. */
export function stampHopMinOuts(hops: Hop[], hopSimOuts: bigint[], slipBps = SLIP_BPS): Hop[] {
  if (hops.length !== hopSimOuts.length) throw new Error("need one sim out per hop");
  if (hops.length === 0) return hops;
  const lastSim = hopSimOuts[hopSimOuts.length - 1]!;
  return hops.map((h, i) => {
    const minOut = conservativeMinOut(hopSimOuts[i]!, slipBps);
    if (i < hops.length - 1 && hopSimOuts[i] === lastSim) {
      throw new Error("intermediate hop sim equals last-leg — refuse last-leg reuse");
    }
    if (i < hops.length - 1 && minOut === conservativeMinOut(lastSim, slipBps) && hopSimOuts[i] !== lastSim) {
      throw new Error("intermediate floor collapsed to last-leg");
    }
    return { ...h, minOut };
  });
}

/** Single-hop only. Multi-hop must call stampHopMinOuts with per-hop sims. */
export function stampProductionHops(hops: Hop[], finalMinOut: bigint): Hop[] {
  if (hops.length > 1) throw new Error("multi-hop requires stampHopMinOuts(per-hop sims)");
  if (finalMinOut <= 1n) throw new Error("production minOut must exceed dust");
  if (hops.length === 0) return hops;
  return [{ ...hops[0]!, minOut: finalMinOut }];
}

async function previewAndStamp(
  to: `0x${string}`,
  abi: typeof flywheelAbi | typeof buybackAbi,
  fn: "previewSettleQuote" | "previewTop10Hops" | "previewExecuteHops",
  args: readonly unknown[],
  account: `0x${string}`,
  hops: Hop[],
): Promise<Hop[] | null> {
  try {
    await client.simulateContract({
      address: to,
      abi,
      functionName: fn,
      args: args as never,
      account,
    });
    return null;
  } catch (e) {
    const parsed = previewHopsFromError(e);
    if (!parsed || parsed.hopOuts.length !== hops.length) return null;
    if (parsed.hopOuts.some((o) => o <= 1n)) return null;
    try {
      return stampHopMinOuts(hops, parsed.hopOuts);
    } catch {
      return null;
    }
  }
}

function previewHopsFromError(e: unknown): { hopOuts: bigint[]; finalOut: bigint } | null {
  const stack: unknown[] = [e];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    const rec = cur as { errorName?: string; args?: unknown[]; data?: unknown; cause?: unknown };
    if (rec.errorName === "PreviewHops" && Array.isArray(rec.args) && rec.args.length >= 2) {
      return {
        hopOuts: (rec.args[0] as bigint[]).map((x) => BigInt(x)),
        finalOut: BigInt(rec.args[1] as bigint),
      };
    }
    if (rec.data) stack.push(rec.data);
    if (rec.cause) stack.push(rec.cause);
  }
  return null;
}

async function tick() {
  const chainId = await client.getChainId();
  if (chainId === MAINNET_CHAIN) {
    writeBeat({ ok: false, reason: "mainnet disabled" });
    throw new Error("mainnet disabled");
  }
  const runAsLeader = async (lease?: LeaderLease) => {
    const prevLease = activeLease;
    activeLease = lease;
    try {
      await tickBody(chainId);
    } finally {
      activeLease = prevLease;
    }
  };
  if (!jobStore) {
    await runAsLeader(undefined);
    return;
  }
  const held = await withLeaderLock(jobStore, OWNER, async (lease) => {
    await runAsLeader(lease);
    return true;
  });
  if (!held) {
    writeBeat({ ok: true, reason: "standby — not leader", chainId });
  }
}

async function tickBody(chainId: number) {
  const state = await loadState();
  const flywheel = addrs.FlywheelVault as `0x${string}` | undefined;
  const selfBurn = addrs.SelfBurnVault as `0x${string}` | undefined;
  const buyback = addrs.BuybackVault as `0x${string}` | undefined;
  const factory = addrs.ReactorFactory as `0x${string}` | undefined;
  const curve = addrs.InstantCurve as `0x${string}` | undefined;
  const jobs: string[] = [];
  const block = await client.getBlockNumber();

  const res = await fetch(API);
  if (!res.ok) throw new Error(`top10 http ${res.status}`);
  const body = (await res.json()) as Top10;
  const accept = acceptTop10Snapshot(body, Math.floor(Date.now() / 1000));
  if (!accept.ok) {
    writeBeat({ ok: false, pauseEpoch: true, reason: accept.reason, block: block.toString(), chainId, jobs });
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

  const { quotes, usdc } = await discoverQuotes();
  await syncLiveOfficialVenues();
  const protocol = (addrs.ProtocolV4Adapter ?? addrs.V4Adapter) as `0x${string}` | undefined;
  const adapters = new Set<string>();
  if (protocol) adapters.add(protocol.toLowerCase());
  if (addrs.V4Adapter) adapters.add(addrs.V4Adapter.toLowerCase());

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
          if (!sim || sim.result === undefined) continue;
          let minOut: bigint;
          try {
            minOut = conservativeMinOut(sim.result as bigint);
          } catch {
            writeBeat({ ok: false, reason: `weak selfburn minOut ${token}`, jobs });
            continue;
          }
          await run(
            `selfburn:${token.toLowerCase()}:${acc.toString()}`,
            selfBurn,
            encodeFunctionData({ abi: selfBurnAbi, functionName: "execute", args: [token, minOut] }),
          );
        }
      }
    }
  }

  if (flywheel) {
    for (const q of quotes) {
      const acc = (await client.readContract({
        address: flywheel,
        abi: flywheelAbi,
        functionName: "quoteAccrued",
        args: [q],
      })) as bigint;
      let bal = 0n;
      try {
        bal = (await client.readContract({ address: q, abi: erc20Abi, functionName: "balanceOf", args: [flywheel] })) as bigint;
      } catch {
        bal = 0n;
      }
      if (acc < THRESHOLD && bal < THRESHOLD) continue;
      let hops: Hop[] = [];
      try {
        hops = await hopsOrEmpty(q, usdc, adapters);
      } catch (e) {
        writeBeat({ ok: false, reason: `no settle route ${q}: ${e}`, jobs });
        continue;
      }
      let hops2 = hops;
      if (hops.length > 0) {
        const stamped = await previewAndStamp(flywheel, flywheelAbi, "previewSettleQuote", [q, hops], account.address, hops);
        if (!stamped) continue;
        hops2 = stamped;
      }
      const probeMin = q.toLowerCase() === usdc.toLowerCase() ? acc : 1n;
      const sim = await client
        .simulateContract({
          address: flywheel,
          abi: flywheelAbi,
          functionName: "settleQuote",
          args: [q, hops2, probeMin],
          account: account.address,
        })
        .catch(() => null);
      if (!sim || sim.result === undefined) continue;
      let minOut: bigint;
      try {
        minOut = q.toLowerCase() === usdc.toLowerCase() ? (sim.result as bigint) : conservativeMinOut(sim.result as bigint);
      } catch {
        continue;
      }
      if (minOut <= 1n && q.toLowerCase() !== usdc.toLowerCase()) continue;
      await run(
        `settle:${q.toLowerCase()}:${acc.toString()}`,
        flywheel,
        encodeFunctionData({ abi: flywheelAbi, functionName: "settleQuote", args: [q, hops2, minOut] }),
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
      let hops: Hop[] = [];
      try {
        hops = await hopsOrEmpty(q, usdc, adapters);
      } catch {
        continue;
      }
      let hops2 = hops;
      if (hops.length > 0) {
        const stamped = await previewAndStamp(buyback, buybackAbi, "previewExecuteHops", [q, hops], account.address, hops);
        if (!stamped) continue;
        hops2 = stamped;
      }
      const sim = await client
        .simulateContract({
          address: buyback,
          abi: buybackAbi,
          functionName: "execute",
          args: [q, hops2, 1n],
          account: account.address,
        })
        .catch(() => null);
      if (!sim || sim.result === undefined) continue;
      let minOut: bigint;
      try {
        minOut = conservativeMinOut(sim.result as bigint);
      } catch {
        continue;
      }
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
      const onchainRows: Array<{ token: string; weightBps: number }> = [];
      for (let i = 0; i < 10; i++) {
        const t = (await client.readContract({
          address: flywheel,
          abi: flywheelAbi,
          functionName: "ranked",
          args: [BigInt(i)],
        })) as `0x${string}`;
        if (!t || t === "0x0000000000000000000000000000000000000000") continue;
        const w = Number(
          await client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "weights", args: [BigInt(i)] }),
        );
        onchainRows.push({ token: t, weightBps: w });
      }
      const targets = frozenEpochTargets(onchainRows, body.rows);
      const hook = addrs.ReactorHook as `0x${string}` | undefined;
      for (const row of targets) {
        const bought = await client.readContract({
          address: flywheel,
          abi: flywheelAbi,
          functionName: "bought",
          args: [epoch, row.token as `0x${string}`],
        });
        if (bought) continue;
        let hops: Hop[] = [];
        if (hook) {
          const mkt = (await client.readContract({
            address: hook,
            abi: hookAbi,
            functionName: "marketOfToken",
            args: [row.token as `0x${string}`],
          })) as readonly [string, string, boolean];
          const quote = mkt[1] as `0x${string}`;
          if (quote && quote.toLowerCase() !== usdc.toLowerCase()) {
            try {
              hops = await hopsOrEmpty(usdc, quote, adapters);
            } catch {
              continue;
            }
          }
        }
        let hops2 = hops;
        if (hops.length > 0) {
          const stamped = await previewAndStamp(
            flywheel,
            flywheelAbi,
            "previewTop10Hops",
            [row.token as `0x${string}`, hops],
            account.address,
            hops,
          );
          if (!stamped) continue;
          hops2 = stamped;
        }
        const sim = await client
          .simulateContract({
            address: flywheel,
            abi: flywheelAbi,
            functionName: "executeTop10Buyback",
            args: [row.token as `0x${string}`, hops2, 1n],
            account: account.address,
          })
          .catch(() => null);
        if (!sim || sim.result === undefined) continue;
        let minOut: bigint;
        try {
          minOut = conservativeMinOut(sim.result as bigint);
        } catch {
          continue;
        }
        await run(
          `top10:${epoch.toString()}:${row.token.toLowerCase()}`,
          flywheel,
          encodeFunctionData({
            abi: flywheelAbi,
            functionName: "executeTop10Buyback",
            args: [row.token as `0x${string}`, hops2, minOut],
          }),
        );
      }
      const pot = (await client.readContract({ address: flywheel, abi: flywheelAbi, functionName: "usdcPot" })) as bigint;
      const allBought = await Promise.all(
        targets.map((r) =>
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
    quotes: quotes.length,
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
    if (e instanceof LeaderLeaseLostError) {
      console.error("keeper lost leadership mid-tick — refuse further broadcast", e);
      writeBeat({ ok: true, pauseEpoch: false, submitted: false, reason: e.message });
    } else {
      console.error("keeper tick failed (fail closed)", e);
      writeBeat({ ok: false, pauseEpoch: true, submitted: false, reason: String(e) });
    }
  }
  if (process.env.KEEPER_ONCE === "1") return;
  setTimeout(loop, INTERVAL);
}

if (process.env.KEEPER_TEST !== "1") {
  console.log(`keeper daemon mode=${MODE} → ${API} heartbeat ${HEARTBEAT}`);
  openStore()
    .then((s) => {
      jobStore = s;
      loop();
    })
    .catch((e) => {
      console.error("keeper store failed — refuse start", e);
      process.exit(1);
    });
}
