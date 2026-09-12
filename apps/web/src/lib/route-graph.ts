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
import { indexCalls, readContractsBatched } from "./rpc-batch";

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
      const listed = n > 0
        ? await readContractsBatched<`0x${string}`>(client, indexCalls(registry.address, registry.abi, "list", n))
        : [];
      const rows = listed.length
        ? await readContractsBatched<readonly unknown[]>(
            client,
            listed.map((token) => ({ ...registry, functionName: "get", args: [token] })),
            { allowFailure: true },
          )
        : [];
      const hopCandidates: `0x${string}`[] = [];
      for (let i = 0; i < listed.length; i++) {
        const token = listed[i]!;
        const g = rows[i] ?? [];
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
          hopCandidates.push(token);
        }
      }
      const hopSqrts = await Promise.all(
        hopCandidates.map((token) => readSqrtPriceX96(client, poolId(hooklessHopKey(usdc, token)))),
      );
      for (let i = 0; i < hopCandidates.length; i++) {
        if (!hopSqrts[i] || !adapter) continue;
        const token = hopCandidates[i]!;
        const data = encodePoolKey(hooklessHopKey(usdc, token));
        raw.push(
          { from: usdc, to: token, adapter, kind: "user", data, usable: true, exists: true },
          { from: token, to: usdc, adapter, kind: "user", data, usable: true, exists: true },
        );
      }
    } catch {
      /* fail closed */
    }
  }

  try {
    const len = Number(await client.readContract({ ...factory, functionName: "allTokensLength" }));
    const tokens = len > 0
      ? await readContractsBatched<`0x${string}`>(client, indexCalls(factory.address, factory.abi, "allTokens", len))
      : [];
    const infos = tokens.length
      ? await readContractsBatched<readonly unknown[]>(
          client,
          tokens.map((token) => ({ ...factory, functionName: "tokenInfo", args: [token] })),
          { allowFailure: true },
        )
      : [];
    const live: Array<{ token: `0x${string}`; quote: `0x${string}` }> = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const info = infos[i] ?? [];
      const quote = String(info[1] ?? "") as `0x${string}`;
      if (!Boolean(info[5]) || !adapter || !hook || !quote) continue;
      live.push({ token, quote });
    }
    const sqrts = await Promise.all(live.map((row) => readSqrtPriceX96(client, poolId(officialPoolKey(row.token, row.quote)))));
    for (let i = 0; i < live.length; i++) {
      if (!sqrts[i] || !adapter) continue;
      const { token, quote } = live[i]!;
      const data = encodePoolKey(officialPoolKey(token, quote));
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
