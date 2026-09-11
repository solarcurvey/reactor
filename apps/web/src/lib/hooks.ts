"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { addresses } from "./addresses";
import { factory, registry, token, erc20, buyback, core, curve } from "./contracts";
import { CATEGORY_LABELS } from "./addresses";
import { INDEXER_URL } from "./chain";
import { FIXTURE_TOKENS, REVIEW_FIXTURES } from "./review-fixtures";

export type QuoteAsset = {
  token: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  category: number;
  categoryLabel: string;
  enabled: boolean;
  exists: boolean;
  usdPegOne?: boolean;
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
  rewardsMode?: boolean;
  bonding?: boolean;
  bondingBps?: number;
  realQuote?: bigint;
  gradTarget?: bigint;
  devBought?: bigint;
  ready?: boolean;
  curve?: `0x${string}`;
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
      enabled: boolean;
      exists: boolean;
      buybackRouteEnabled?: boolean;
      usdPegOne?: boolean;
    };
    if (!asset.enabled) continue;
    if (asset.buybackRouteEnabled === false) continue;
    out.push({
      ...asset,
      usdPegOne: Boolean(asset.usdPegOne) || asset.symbol === "USDC",
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
    const rawInfo = await client.readContract({
      ...factory,
      functionName: "tokenInfo",
      args: [addr],
    });
    const info = unwrapTokenInfo(rawInfo);
    const rawMeta = await client.readContract({
      ...factory,
      functionName: "metadata",
      args: [addr],
    });
    const meta = unwrapMeta(rawMeta);
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
        address: info.quote,
        abi: erc20.abi,
        functionName: "symbol",
      })) as string;
      quoteDecimals = (await client.readContract({
        address: info.quote,
        abi: erc20.abi,
        functionName: "decimals",
      })) as number;
    } catch {
      /* empty */
    }
    let rewardsMode = true;
    let bonding = false;
    let bondingBps = 0;
    let realQuote = 0n;
    let gradTarget = 0n;
    let devBought = 0n;
    let ready = false;
    let curveAddr: `0x${string}` | undefined;
    try {
      rewardsMode = (await client.readContract({
        ...factory,
        functionName: "isRewards",
        args: [addr],
      })) as boolean;
      curveAddr = (await client.readContract({
        ...factory,
        functionName: "curve",
      })) as `0x${string}`;
      if (Number(info.mode) === 0 && !info.marketLive && curveAddr && curveAddr !== "0x0000000000000000000000000000000000000000") {
          bonding = true;
          bondingBps = Number(
            (await client.readContract({
              address: curveAddr,
              abi: curve.abi,
              functionName: "bondingPct",
              args: [addr],
            })) as bigint,
          );
          realQuote = (await client.readContract({
            address: curveAddr,
            abi: curve.abi,
            functionName: "realQuoteOf",
            args: [addr],
          })) as bigint;
          gradTarget = (await client.readContract({
            address: curveAddr,
            abi: curve.abi,
            functionName: "gradTargetOf",
            args: [addr],
          })) as bigint;
          devBought = (await client.readContract({
            address: curveAddr,
            abi: curve.abi,
            functionName: "devBoughtOf",
            args: [addr],
          })) as bigint;
          ready = (await client.readContract({
            address: curveAddr,
            abi: curve.abi,
            functionName: "readyOf",
            args: [addr],
          })) as boolean;
      }
    } catch {
      /* curve not bound on older deploys */
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
      rewardsMode,
      bonding,
      bondingBps,
      realQuote,
      gradTarget,
      devBought,
      ready,
      curve: curveAddr,
    });
  }
  const out = tokens.reverse();
  if (out.length === 0) return FIXTURE_TOKENS;
  return out;
}

function field(raw: unknown, name: string, index: number) {
  if (Array.isArray(raw)) return raw[index];
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rec, name) && rec[name] !== undefined) return rec[name];
    if (rec[index] !== undefined) return rec[index];
    if (rec[String(index)] !== undefined) return rec[String(index)];
  }
  return undefined;
}

function unwrapTokenInfo(raw: unknown) {
  return {
    token: field(raw, "token", 0) as `0x${string}`,
    quote: field(raw, "quote", 1) as `0x${string}`,
    creator: field(raw, "creator", 2) as `0x${string}`,
    mode: Number(field(raw, "mode", 3) ?? 0),
    poolId: field(raw, "poolId", 4) as `0x${string}`,
    marketLive: Boolean(field(raw, "marketLive", 5)),
    fairId: BigInt(field(raw, "fairId", 6) as bigint | number | string | undefined ?? 0),
  };
}

function unwrapMeta(raw: unknown) {
  return {
    image: String(field(raw, "image", 0) ?? ""),
    description: String(field(raw, "description", 1) ?? ""),
    website: String(field(raw, "website", 2) ?? ""),
    twitter: String(field(raw, "twitter", 3) ?? ""),
    telegram: String(field(raw, "telegram", 4) ?? ""),
  };
}

export function unwrapFair(raw: unknown) {
  return {
    token: field(raw, "token", 0) as `0x${string}`,
    quote: field(raw, "quote", 1) as `0x${string}`,
    creator: field(raw, "creator", 2) as `0x${string}`,
    startTime: BigInt(field(raw, "startTime", 3) as bigint | number | string ?? 0),
    endTime: BigInt(field(raw, "endTime", 4) as bigint | number | string ?? 0),
    auctionBps: Number(field(raw, "auctionBps", 5) ?? 0),
    minRaise: BigInt(field(raw, "minRaise", 6) as bigint | number | string ?? 0),
    totalBids: BigInt(field(raw, "totalBids", 7) as bigint | number | string ?? 0),
    auctionTokens: BigInt(field(raw, "auctionTokens", 8) as bigint | number | string ?? 0),
    lpTokens: BigInt(field(raw, "lpTokens", 9) as bigint | number | string ?? 0),
    finalized: Boolean(field(raw, "finalized", 10)),
    migrated: Boolean(field(raw, "migrated", 11)),
    poolId: field(raw, "poolId", 12) as `0x${string}`,
  };
}

export function useQuotes() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["quotes"],
    enabled: !!client || REVIEW_FIXTURES,
    queryFn: async () => {
      try {
        if (!client) throw new Error("no client");
        return await readQuotes(client);
      } catch (e) {
        if (REVIEW_FIXTURES) {
          return [
            { token: "0x4826533B4897376654Bb4d4AD88B7faFD0C98528" as `0x${string}`, symbol: "USDC", name: "USD Coin", decimals: 6, icon: "", category: 4, categoryLabel: "Stablecoins", enabled: true, exists: true },
            { token: "0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf" as `0x${string}`, symbol: "ZEC", name: "Mock ZEC", decimals: 8, icon: "", category: 0, categoryLabel: "Crypto", enabled: true, exists: true },
            { token: "0x0E801D84Fa97b50751Dbf25036d067dCf18858bF" as `0x${string}`, symbol: "BTC", name: "Mock BTC", decimals: 8, icon: "", category: 0, categoryLabel: "Crypto", enabled: true, exists: true },
          ];
        }
        throw e;
      }
    },
    refetchInterval: 15_000,
  });
}

export function useLaunchTokens() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["launches"],
    enabled: !!client || REVIEW_FIXTURES,
    queryFn: async () => {
      try {
        if (!client) throw new Error("no client");
        return await readTokens(client);
      } catch (e) {
        if (REVIEW_FIXTURES) return FIXTURE_TOKENS;
        throw e;
      }
    },
    refetchInterval: 8_000,
  });
}

export function useCoreStats() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["core-stats"],
    enabled: !!client,
    queryFn: async () => {
      const [supply, accruedUsdc, lifetimeAccrued, lifetimeBurned, threshold, purchased] = await Promise.all([
        client!.readContract({ ...core, functionName: "totalSupply" }) as Promise<bigint>,
        client!.readContract({
          ...buyback,
          functionName: "accrued",
          args: [addresses.USDC],
        }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "lifetimeAccrued" }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "lifetimeBurned" }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "threshold" }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "lifetimePurchased" }) as Promise<bigint>,
      ]);
      // Real burn() shrinks totalSupply. BuybackVault.lifetimeBurned is the Keeper path.
      return { supply, burnedBal: lifetimeBurned, accruedUsdc, lifetimeAccrued, lifetimeBurned, threshold, purchased };
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
      const empty: {
        t: number;
        ts?: number;
        notional: string;
        holders: string;
        buyback: string;
        flywheel?: string;
        coreAmt?: string;
        sqrtPrice?: string;
        px?: string;
        source?: string;
      }[] = [];
      const fixtures = [
        { t: 1, notional: "1000000000", holders: "20000000", buyback: "15000000", flywheel: "10000000", coreAmt: "5000000", sqrtPrice: "79228162514264337593543950336" },
        { t: 2, notional: "2000000000", holders: "40000000", buyback: "30000000", flywheel: "20000000", coreAmt: "10000000", sqrtPrice: "85000000000000000000000000000" },
        { t: 3, notional: "800000000", holders: "16000000", buyback: "12000000", flywheel: "8000000", coreAmt: "4000000", sqrtPrice: "91000000000000000000000000000" },
      ];
      const res = await fetch(`${INDEXER_URL}/swaps/${token}`).catch(() => null);
      if (!res?.ok) return REVIEW_FIXTURES ? fixtures : empty;
      const rows = (await res.json()) as typeof empty;
      if (REVIEW_FIXTURES && rows.length === 0) return fixtures;
      return rows;
    },
    refetchInterval: 8_000,
  });
}

export function useReactorEvents() {
  return useQuery({
    queryKey: ["reactor-events"],
    queryFn: async () => {
      const res = await fetch(`${INDEXER_URL}/reactor`).catch(() => null);
      if (!res?.ok) return { events: [] as { name: string; token: string; payload: string; block: number; tx: string }[] };
      return (await res.json()) as { events: { name: string; token: string; payload: string; block: number; tx: string }[] };
    },
    refetchInterval: 8_000,
  });
}

export function useTokenByAddress(address?: string) {
  const { data, ...rest } = useLaunchTokens();
  const token_ = useMemo(() => {
    const found = data?.find((t) => t.token.toLowerCase() === address?.toLowerCase());
    if (found) return found;
    if (REVIEW_FIXTURES) {
      return FIXTURE_TOKENS.find((t) => t.token.toLowerCase() === address?.toLowerCase());
    }
    return found;
  }, [data, address]);
  return { data: token_, ...rest };
}
