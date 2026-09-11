import { concat, encodeFunctionData, hexToBigInt, keccak256, pad, toHex, type PublicClient } from "viem";
import { addresses } from "./addresses";
import { factory, token as tokenC, erc20 } from "./contracts";
import { officialPoolKey, poolId } from "./pool";
import { rankTop10, TOP10_FLOOR_USDC, type RankCandidate } from "./top10";

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
    if (live && !isCore) {
      const resolved = await resolveMarkUsdc(client, token, quote, quoteUsd, 0, new Set());
      markUsdc = resolved.markUsdc;
      markOk = resolved.ok;
    }
    const symbol = live
      ? ((await client.readContract({ address: token, abi: tokenC.abi, functionName: "symbol" }).catch(() => token.slice(0, 6))) as string)
      : token.slice(0, 6);
    cands.push({ token, symbol, quote, graduated: live, isCore, markUsdc, markOk });
  }

  const { rows, pauseEpoch } = rankTop10(cands, TOP10_FLOOR_USDC);
  return {
    rows,
    pauseEpoch,
    candidates: cands.length,
    reason: pauseEpoch
      ? "unreliable mark — skip token / pause epoch, never guess"
      : rows.length === 0
        ? "no graduated names with a defensible mark ≥ $250k"
        : "operational ranks from on-chain discovery (~5 min)",
  };
}

async function resolveMarkUsdc(
  client: PublicClient,
  token: `0x${string}`,
  quote: `0x${string}`,
  cache: Map<string, { usd6: bigint; ok: boolean }>,
  depth: number,
  stack: Set<string>,
): Promise<{ markUsdc: bigint; ok: boolean }> {
  if (depth > MAX_QUOTE_DEPTH) return { markUsdc: 0n, ok: false };
  const tKey = token.toLowerCase();
  if (stack.has(tKey)) return { markUsdc: 0n, ok: false };
  stack.add(tKey);

  const supply = (await client.readContract({ address: token, abi: tokenC.abi, functionName: "totalSupply" }).catch(() => 0n)) as bigint;
  const quoteDec = Number((await client.readContract({ address: quote, abi: erc20.abi, functionName: "decimals" }).catch(() => 18)) as number);
  const key = officialPoolKey(token, quote);
  const id = poolId(key);
  const sqrt = await readSqrtPriceX96(client, id);
  if (!sqrt || supply === 0n) {
    stack.delete(tKey);
    return { markUsdc: 0n, ok: false };
  }
  const tokenIs0 = token.toLowerCase() < quote.toLowerCase();
  const fdvQuote = fdvQuoteRaw(sqrt, supply, tokenIs0);

  const qUsd = await quoteToUsd6(client, quote, cache, depth, stack);
  stack.delete(tKey);
  if (!qUsd.ok) return { markUsdc: 0n, ok: false };
  const markUsdc = (fdvQuote * qUsd.usd6) / 10n ** BigInt(quoteDec);
  return { markUsdc, ok: true };
}

async function quoteToUsd6(
  client: PublicClient,
  quote: `0x${string}`,
  cache: Map<string, { usd6: bigint; ok: boolean }>,
  depth: number,
  stack: Set<string>,
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
      const nested = await resolveMarkUsdc(client, quote as `0x${string}`, parentQuote, cache, depth + 1, stack);
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
