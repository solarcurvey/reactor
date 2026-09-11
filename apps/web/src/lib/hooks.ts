"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { addresses } from "./addresses";
import { factory, registry, token, erc20, buyback, core } from "./contracts";
import { CATEGORY_LABELS } from "./addresses";
import { INDEXER_URL } from "./chain";

export type QuoteAsset = {
  token: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  category: number;
  categoryLabel: string;
  usdOracle: `0x${string}`;
  enabled: boolean;
  exists: boolean;
};

export type LaunchToken = {
  token: `0x${string}`;
  quote: `0x${string}`;
  creator: `0x${string}`;
  mode: number;
  poolId: `0x${string}`;
  marketLive: boolean;
  fairId: bigint;
  name: string;
  symbol: string;
  decimals: number;
  supply: bigint;
  image: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  quoteSymbol?: string;
  quoteDecimals?: number;
  lifetimeRewards?: bigint;
  pendingRewards?: bigint;
};

async function readQuotes(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<QuoteAsset[]> {
  const count = await client.readContract({
    ...registry,
    functionName: "count",
  });
  const n = Number(count as bigint);
  const out: QuoteAsset[] = [];
  for (let i = 0; i < n; i++) {
    const addr = (await client.readContract({
      ...registry,
      functionName: "list",
      args: [BigInt(i)],
    })) as `0x${string}`;
    const asset = (await client.readContract({
      ...registry,
      functionName: "get",
      args: [addr],
    })) as {
      token: `0x${string}`;
      symbol: string;
      name: string;
      decimals: number;
      icon: string;
      category: number;
      usdOracle: `0x${string}`;
      enabled: boolean;
      exists: boolean;
    };
    if (!asset.enabled) continue;
    out.push({
      ...asset,
      categoryLabel: CATEGORY_LABELS[asset.category] ?? "Other",
    });
  }
  return out;
}

async function readTokens(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<LaunchToken[]> {
  const len = Number(
    (await client.readContract({
      ...factory,
      functionName: "allTokensLength",
    })) as bigint,
  );
  const tokens: LaunchToken[] = [];
  for (let i = 0; i < len; i++) {
    const addr = (await client.readContract({
      ...factory,
      functionName: "allTokens",
      args: [BigInt(i)],
    })) as `0x${string}`;
    const info = (await client.readContract({
      ...factory,
      functionName: "tokenInfo",
      args: [addr],
    })) as {
      token: `0x${string}`;
      quote: `0x${string}`;
      creator: `0x${string}`;
      mode: number;
      poolId: `0x${string}`;
      marketLive: boolean;
      fairId: bigint;
    };
    const meta = (await client.readContract({
      ...factory,
      functionName: "metadata",
      args: [addr],
    })) as { image: string; description: string; website: string; twitter: string; telegram: string };
    const [name, symbol, decimals, supply, lifetimeRewards] = (await Promise.all([
      client.readContract({ address: addr, abi: token.abi, functionName: "name" }),
      client.readContract({ address: addr, abi: token.abi, functionName: "symbol" }),
      client.readContract({ address: addr, abi: token.abi, functionName: "decimals" }),
      client.readContract({ address: addr, abi: token.abi, functionName: "totalSupply" }),
      client.readContract({ address: addr, abi: token.abi, functionName: "lifetimeRewards" }),
    ])) as [string, string, number, bigint, bigint];
    let quoteSymbol = "";
    let quoteDecimals = 18;
    try {
      quoteSymbol = (await client.readContract({
        address: info[1],
        abi: erc20.abi,
        functionName: "symbol",
      })) as string;
      quoteDecimals = (await client.readContract({
        address: info[1],
        abi: erc20.abi,
        functionName: "decimals",
      })) as number;
    } catch {
      /* empty */
    }
    tokens.push({
      token: addr,
      quote: info.quote,
      creator: info.creator,
      mode: Number(info.mode),
      poolId: info.poolId,
      marketLive: info.marketLive,
      fairId: info.fairId,
      name,
      symbol,
      decimals: Number(decimals),
      supply,
      image: meta.image,
      description: meta.description,
      website: meta.website,
      twitter: meta.twitter,
      telegram: meta.telegram,
      quoteSymbol,
      quoteDecimals: Number(quoteDecimals),
      lifetimeRewards,
    });
  }
  return tokens.reverse();
}

export function useQuotes() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["quotes"],
    enabled: !!client,
    queryFn: () => readQuotes(client!),
    refetchInterval: 15_000,
  });
}

export function useLaunchTokens() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["launches"],
    enabled: !!client,
    queryFn: () => readTokens(client!),
    refetchInterval: 8_000,
  });
}

export function useCoreStats() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["core-stats"],
    enabled: !!client,
    queryFn: async () => {
      const [supply, burnedBal, accruedUsdc, lifetimeAccrued, lifetimeBurned, threshold] = await Promise.all([
        client!.readContract({ ...core, functionName: "totalSupply" }) as Promise<bigint>,
        client!.readContract({
          ...core,
          functionName: "balanceOf",
          args: ["0x000000000000000000000000000000000000dEaD"],
        }) as Promise<bigint>,
        client!.readContract({
          ...buyback,
          functionName: "accrued",
          args: [addresses.USDC],
        }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "lifetimeAccrued" }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "lifetimeBurned" }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "threshold" }) as Promise<bigint>,
      ]);
      return { supply, burnedBal, accruedUsdc, lifetimeAccrued, lifetimeBurned, threshold };
    },
    refetchInterval: 8_000,
  });
}

export function useIndexerHealth() {
  return useQuery({
    queryKey: ["indexer"],
    queryFn: async () => {
      const res = await fetch(`${INDEXER_URL}/health`).catch(() => null);
      if (!res?.ok) return { ok: false };
      return (await res.json()) as { ok: boolean; block?: number };
    },
    refetchInterval: 10_000,
  });
}

export function useSwapSeries(token?: string) {
  return useQuery({
    queryKey: ["swaps", token],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${INDEXER_URL}/swaps/${token}`).catch(() => null);
      if (!res?.ok) return [] as { t: number; notional: string; holders: string; buyback: string }[];
      return (await res.json()) as { t: number; notional: string; holders: string; buyback: string }[];
    },
    refetchInterval: 8_000,
  });
}

export function useTokenByAddress(address?: string) {
  const { data, ...rest } = useLaunchTokens();
  const token_ = useMemo(
    () => data?.find((t) => t.token.toLowerCase() === address?.toLowerCase()),
    [data, address],
  );
  return { data: token_, ...rest };
}
