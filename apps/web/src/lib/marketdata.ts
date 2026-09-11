import { concat, encodeFunctionData, hexToBigInt, keccak256, pad, toHex, type PublicClient } from "viem";
import { addresses } from "./addresses";
import { factory, token as tokenC, erc20 } from "./contracts";
import { officialPoolKey, poolId } from "./pool";
import { rankTop10, TOP10_FLOOR_USDC, type RankCandidate } from "./top10";
import { INDEXER_URL } from "./chain";

/** 12 minutes — middle of the frozen 10–15m VWAP/TWAP window. */
export const MARK_WINDOW_SEC = 12 * 60;
export const MIN_VWAP_SAMPLES = 3;

const POOLS_SLOT = 6n;
const MAX_QUOTE_DEPTH = 3;

const extsloadAbi = [
  { name: "extsload", type: "function", stateMutability: "view", inputs: [{ name: "slot", type: "bytes32" }], outputs: [{ name: "value", type: "bytes32" }] },
] as const;

function poolStateSlot(id: `0x${string}`): `0x${string}` {
  return keccak256(concat([id, pad(toHex(POOLS_SLOT), { size: 32 })]));
}

export async function readSqrtPriceX96(client: PublicClient, id: `0x${string}`): Promise<bigint | null> {
  try {
    const word = (await client.readContract({
      address: addresses.PoolManager,
      abi: extsloadAbi,
      functionName: "extsload",
      args: [poolStateSlot(id)],
    })) as `0x${string}`;
    const sqrt = hexToBigInt(word) & ((1n << 160n) - 1n);
    return sqrt === 0n ? null : sqrt;
  } catch {
    return null;
  }
}

/** FDV in quote raw units from official sqrtPrice and circulating/total supply. */
export function fdvQuoteRaw(sqrt: bigint, supply: bigint, tokenIs0: boolean): bigint {
  if (sqrt === 0n || supply === 0n) return 0n;
  const Q192 = 1n << 192n;
  return tokenIs0 ? (supply * sqrt * sqrt) / Q192 : (supply * Q192) / (sqrt * sqrt);
}

export type TradeSample = { notional: bigint; sqrtPrice: bigint; ts: number };

/** Volume-weighted FDV in quote raw from indexed trades. Fail closed on thin windows. */
export function vwapFdvQuoteRaw(samples: TradeSample[], supply: bigint, tokenIs0: boolean, nowSec: number, windowSec = MARK_WINDOW_SEC): { fdv: bigint; ok: boolean } {
  const from = nowSec - windowSec;
  const inWin = samples.filter((s) => s.ts >= from && s.sqrtPrice > 0n && s.notional > 0n);
  if (inWin.length < MIN_VWAP_SAMPLES || supply === 0n) return { fdv: 0n, ok: false };
  let num = 0n;
  let den = 0n;
  for (const s of inWin) {
    const fdv = fdvQuoteRaw(s.sqrtPrice, supply, tokenIs0);
    if (fdv === 0n) continue;
    num += fdv * s.notional;
    den += s.notional;
  }
  if (den === 0n) return { fdv: 0n, ok: false };
  return { fdv: num / den, ok: true };
}

async function fetchIndexedTrades(token: string): Promise<TradeSample[]> {
  try {
    const res = await fetch(`${INDEXER_URL}/swaps/${token}`);
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ t?: number; ts?: number; notional?: string; sqrtPrice?: string; block?: number }>;
    return rows.map((r) => ({
      notional: BigInt(r.notional ?? "0"),
      sqrtPrice: BigInt(r.sqrtPrice ?? "0"),
      ts: Number(r.ts ?? r.t ?? r.block ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function discoverTop10(client: PublicClient): Promise<{
  rows: ReturnType<typeof rankTop10>["rows"];
  pauseEpoch: boolean;
  reason: string;
  candidates: number;
}> {
  const core = addresses.TestCORE.toLowerCase();
  const usdc = addresses.USDC.toLowerCase();
  const len = Number((await client.readContract({ ...factory, functionName: "allTokensLength" })) as bigint);
  const quoteUsd = new Map<string, { usd6: bigint; ok: boolean }>();
  quoteUsd.set(usdc, { usd6: 1_000_000n, ok: true });
  const nowSec = Number((await client.getBlock({ blockNumber: await client.getBlockNumber() })).timestamp);

  const cands: RankCandidate[] = [];
  for (let i = 0; i < len; i++) {
    const addr = (await client.readContract({
      ...factory,
      functionName: "allTokens",
      args: [BigInt(i)],
    })) as `0x${string}`;
    const info = (await client.readContract({ ...factory, functionName: "tokenInfo", args: [addr] })) as readonly unknown[];
    const token = String(info[0]) as `0x${string}`;
    const quote = String(info[1]) as `0x${string}`;
    const live = Boolean(info[5]);
    const isCore = token.toLowerCase() === core;
    let markUsdc = 0n;
    let markOk = false;
    let lastGoodMarkUsdc = 0n;
    let tradeCount = 0;
    if (live && !isCore) {
      const resolved = await resolveMarkUsdc(client, token, quote, quoteUsd, 0, new Set(), nowSec);
      markUsdc = resolved.markUsdc;
      markOk = resolved.ok;
      lastGoodMarkUsdc = resolved.lastGoodMarkUsdc ?? 0n;
      tradeCount = resolved.tradeCount ?? 0;
    }
    const symbol = live
      ? ((await client.readContract({ address: token, abi: tokenC.abi, functionName: "symbol" }).catch(() => token.slice(0, 6))) as string)
      : token.slice(0, 6);
    cands.push({ token, symbol, quote, graduated: live, isCore, markUsdc, markOk, lastGoodMarkUsdc, tradeCount });
  }

  const ranked = rankTop10(cands, TOP10_FLOOR_USDC);
  return {
    rows: ranked.rows,
    pauseEpoch: ranked.pauseEpoch,
    candidates: cands.length,
    reason: ranked.pauseEpoch
      ? ranked.pauseReason ?? "unreliable mark — pause epoch, never guess"
      : ranked.rows.length === 0
        ? "no graduated names with a defensible 10–15m VWAP ≥ $250k"
        : "operational ranks from indexed 12m VWAP + on-chain discovery (~5 min)",
  };
}

function lastGoodFdvQuote(samples: TradeSample[], supply: bigint, tokenIs0: boolean, nowSec: number): bigint {
  const older = samples.filter((s) => s.ts < nowSec - MARK_WINDOW_SEC && s.sqrtPrice > 0n && s.notional > 0n);
  if (older.length < MIN_VWAP_SAMPLES) return 0n;
  const window = older.slice(-Math.max(MIN_VWAP_SAMPLES, older.length));
  const end = window[window.length - 1]!.ts;
  const v = vwapFdvQuoteRaw(window, supply, tokenIs0, end + MARK_WINDOW_SEC);
  return v.ok ? v.fdv : 0n;
}

async function resolveMarkUsdc(
  client: PublicClient,
  token: `0x${string}`,
  quote: `0x${string}`,
  cache: Map<string, { usd6: bigint; ok: boolean }>,
  depth: number,
  stack: Set<string>,
  nowSec: number,
): Promise<{ markUsdc: bigint; ok: boolean; lastGoodMarkUsdc?: bigint; tradeCount?: number }> {
  if (depth > MAX_QUOTE_DEPTH) return { markUsdc: 0n, ok: false };
  const tKey = token.toLowerCase();
  if (stack.has(tKey)) return { markUsdc: 0n, ok: false };
  stack.add(tKey);

  const supply = (await client.readContract({ address: token, abi: tokenC.abi, functionName: "totalSupply" }).catch(() => 0n)) as bigint;
  const quoteDec = Number((await client.readContract({ address: quote, abi: erc20.abi, functionName: "decimals" }).catch(() => 18)) as number);
  const tokenIs0 = token.toLowerCase() < quote.toLowerCase();
  const trades = await fetchIndexedTrades(token);
  const vwap = vwapFdvQuoteRaw(trades, supply, tokenIs0, nowSec);
  const qUsd = await quoteToUsd6(client, quote, cache, depth, stack, nowSec);
  const toUsdc = (fdvQuote: bigint) =>
    qUsd.ok ? (fdvQuote * qUsd.usd6) / 10n ** BigInt(quoteDec) : quote.toLowerCase() === addresses.USDC.toLowerCase() ? fdvQuote : 0n;

  if (!vwap.ok) {
    stack.delete(tKey);
    return {
      markUsdc: 0n,
      ok: false,
      lastGoodMarkUsdc: toUsdc(lastGoodFdvQuote(trades, supply, tokenIs0, nowSec)),
      tradeCount: trades.length,
    };
  }
  stack.delete(tKey);
  if (!qUsd.ok) return { markUsdc: 0n, ok: false, tradeCount: trades.length };
  return { markUsdc: toUsdc(vwap.fdv), ok: true, tradeCount: trades.length };
}

async function quoteToUsd6(
  client: PublicClient,
  quote: `0x${string}`,
  cache: Map<string, { usd6: bigint; ok: boolean }>,
  depth: number,
  stack: Set<string>,
  nowSec: number,
): Promise<{ usd6: bigint; ok: boolean }> {
  const q = quote.toLowerCase();
  const hit = cache.get(q);
  if (hit) return hit;
  if (q === addresses.USDC.toLowerCase()) {
    const v = { usd6: 1_000_000n, ok: true };
    cache.set(q, v);
    return v;
  }
  if (depth >= MAX_QUOTE_DEPTH) return { usd6: 0n, ok: false };

  // Direct hopless USDC pool (fee 3000) used by demo hops.
  const [c0, c1] = q < addresses.USDC.toLowerCase() ? [quote, addresses.USDC] : [addresses.USDC, quote];
  const hop = {
    currency0: c0 as `0x${string}`,
    currency1: c1 as `0x${string}`,
    fee: 3000,
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  };
  const id = poolId(hop);
  const sqrt = await readSqrtPriceX96(client, id);
  if (sqrt) {
    const quoteIs0 = q < addresses.USDC.toLowerCase();
    const qDec = Number((await client.readContract({ address: quote, abi: erc20.abi, functionName: "decimals" }).catch(() => 8)) as number);
    const one = 10n ** BigInt(qDec);
    const fdv = fdvQuoteRaw(sqrt, one, quoteIs0);
    const usd6 = fdv; // USDC-6 per 1 whole quote token when other side is USDC-6
    const v = { usd6, ok: usd6 > 0n };
    cache.set(q, v);
    return v;
  }

  // Nested: quote is a graduated REACTOR token.
  try {
    const info = (await client.readContract({ ...factory, functionName: "tokenInfo", args: [quote] })) as readonly unknown[];
    const parentQuote = String(info[1]) as `0x${string}`;
    const live = Boolean(info[5]);
    if (live) {
      const nested = await resolveMarkUsdc(client, quote as `0x${string}`, parentQuote, cache, depth + 1, stack, nowSec);
      if (nested.ok) {
        const supply = (await client.readContract({ address: quote, abi: tokenC.abi, functionName: "totalSupply" })) as bigint;
        const dec = Number((await client.readContract({ address: quote, abi: tokenC.abi, functionName: "decimals" })) as number);
        const one = 10n ** BigInt(dec);
        const usd6 = supply === 0n ? 0n : (nested.markUsdc * one) / supply;
        const v = { usd6, ok: usd6 > 0n };
        cache.set(q, v);
        return v;
      }
    }
  } catch {
    /* fail closed */
  }
  const miss = { usd6: 0n, ok: false };
  cache.set(q, miss);
  return miss;
}

export function encodeTop10Calldata() {
  return encodeFunctionData({
    abi: [
      {
        name: "submitEpoch",
        type: "function",
        inputs: [
          { name: "epochId", type: "uint256" },
          { name: "targets", type: "address[]" },
          { name: "weights_", type: "uint256[]" },
        ],
        outputs: [],
      },
    ],
    functionName: "submitEpoch",
    args: [0n, [], []],
  });
}
