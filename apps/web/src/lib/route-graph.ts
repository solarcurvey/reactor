import type { PublicClient } from "viem";
import { addresses } from "./addresses";
import { factory, registry } from "./contracts";
import { encodePoolKey, hooklessHopKey, officialPoolKey, poolId } from "./pool";
import { readSqrtPriceX96 } from "./marketdata";
import {
  approvedEdges,
  planRoute,
  requireProvenPool,
  type MarketEdge,
  type QuoteMeta,
} from "../../../../packages/reactor/src/routes";

const ZERO = "0x0000000000000000000000000000000000000000";

export async function discoverApprovedUserGraph(client: PublicClient): Promise<{
  edges: MarketEdge[];
  quotes: Map<string, QuoteMeta>;
}> {
  const usdc = addresses.USDC;
  const adapter = addresses.V4Adapter;
  const hook = addresses.ReactorHook;
  const quotes = new Map<string, QuoteMeta>();
  const raw: Array<MarketEdge & { exists?: boolean }> = [];

  quotes.set(usdc.toLowerCase(), { token: usdc, symbol: "USDC", enabled: true, usdPegOne: true });

  if (registry.address) {
    try {
      const n = Number(await client.readContract({ ...registry, functionName: "count" }));
      for (let i = 0; i < n; i++) {
        const token = (await client.readContract({ ...registry, functionName: "list", args: [BigInt(i)] })) as `0x${string}`;
        const g = (await client.readContract({ ...registry, functionName: "get", args: [token] })) as readonly unknown[];
        const enabled = Boolean(g[6]);
        const hopViaUsdc = Boolean(g[10]);
        const reactorNative = Boolean(g[11]);
        const usdPegOne = Boolean(g[12]);
        quotes.set(token.toLowerCase(), {
          token,
          symbol: String(g[1]),
          enabled,
          quarantined: Boolean(g[7]) && !enabled,
          usdPegOne,
          reactorNative,
          hopViaUsdc,
        });
        if (adapter && hopViaUsdc && token.toLowerCase() !== usdc.toLowerCase() && !reactorNative) {
          const key = hooklessHopKey(usdc, token);
          const sqrt = await readSqrtPriceX96(client, poolId(key));
          const exists = Boolean(sqrt);
          if (exists) {
            const data = encodePoolKey(key);
            raw.push(
              { from: usdc, to: token, adapter, kind: "user", data, usable: true, exists },
              { from: token, to: usdc, adapter, kind: "user", data, usable: true, exists },
            );
          }
        }
      }
    } catch {
      /* fail closed */
    }
  }

  try {
    const len = Number(await client.readContract({ ...factory, functionName: "allTokensLength" }));
    for (let i = 0; i < len; i++) {
      const token = (await client.readContract({
        ...factory,
        functionName: "allTokens",
        args: [BigInt(i)],
      })) as `0x${string}`;
      const info = (await client.readContract({ ...factory, functionName: "tokenInfo", args: [token] })) as readonly unknown[];
      const quote = String(info[1]) as `0x${string}`;
      const live = Boolean(info[5]);
      if (!live || !adapter || !hook) continue;
      const key = officialPoolKey(token, quote);
      const sqrt = await readSqrtPriceX96(client, poolId(key));
      if (!sqrt) continue;
      const data = encodePoolKey(key);
      raw.push(
        { from: quote, to: token, adapter, kind: "user", data, usable: true, exists: true },
        { from: token, to: quote, adapter, kind: "user", data, usable: true, exists: true },
      );
      if (!quotes.has(token.toLowerCase())) {
        quotes.set(token.toLowerCase(), { token, symbol: token.slice(0, 6), enabled: true, reactorNative: true });
      }
    }
  } catch {
    /* fail closed */
  }

  void ZERO;
  return { edges: approvedEdges(raw), quotes };
}

export async function planUserHops(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
): Promise<
  { adapter: `0x${string}`; tokenIn: `0x${string}`; tokenOut: `0x${string}`; minOut: bigint; data: `0x${string}` }[]
> {
  const adapter = addresses.V4Adapter;
  if (!adapter) return [];
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) return [];
  const { edges, quotes } = await discoverApprovedUserGraph(client);
  const planned = planRoute(tokenIn, tokenOut, edges, quotes, {
    protocol: false,
    adapters: new Set([adapter.toLowerCase()]),
  });
  for (const h of planned.hops) {
    requireProvenPool(true, `${h.tokenIn}/${h.tokenOut}`);
  }
  return planned.hops;
}
