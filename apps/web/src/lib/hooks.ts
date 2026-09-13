"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { addresses } from "./addresses";
import { buyback, core, registry } from "./contracts";
import { REVIEW_FIXTURES } from "./review-fixtures";
import { FAILURE_COPY, ServiceUnavailableError } from "./qa-inject";
import { useQaInject } from "@/components/qa-inject-provider";
import { indexCalls, readContractsBatched } from "./rpc-batch";
import {
  CORE_STALE_MS,
  EXPENSIVE_REFETCH_ON_FOCUS,
  INDEXED_STALE_MS,
  QUOTE_ASSETS_STALE_MS,
  qk,
  type MarketListOpts,
} from "./query";
import {
  fetchIndexerJson,
  loadCandles,
  loadLaunchList,
  loadOneMarket,
  loadQuoteAssets,
  loadReactorEvents,
  loadSwaps,
  loadTickerStatus,
  loadTokenPage,
  quoteAssetRowToQuote,
  type CandlePoint,
  type LaunchToken,
  type QuoteAsset,
} from "./indexed";
import { readCoreStatsBatched, readPendingRewardsPage, readTicketWallet, readWalletSnapshot } from "./wallet-reads";

export type { CandlePoint, LaunchToken, QuoteAsset, MarketListOpts };

const REVIEW_QUOTES: QuoteAsset[] = [
  { token: "0x4826533B4897376654Bb4d4AD88B7faFD0C98528", symbol: "USDC", name: "USD Coin", decimals: 6, icon: "", category: 4, categoryLabel: "Stablecoins", enabled: true, exists: true },
  { token: "0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf", symbol: "ZEC", name: "Mock ZEC", decimals: 8, icon: "", category: 0, categoryLabel: "Crypto", enabled: true, exists: true },
  { token: "0x0E801D84Fa97b50751Dbf25036d067dCf18858bF", symbol: "BTC", name: "Mock BTC", decimals: 8, icon: "", category: 0, categoryLabel: "Crypto", enabled: true, exists: true },
];

async function readQuotesRpc(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<QuoteAsset[]> {
  const count = Number(await client.readContract({ ...registry, functionName: "count" }));
  if (count <= 0) return [];
  const addrs = await readContractsBatched<`0x${string}`>(client, indexCalls(registry.address, registry.abi, "list", count));
  const assets = await readContractsBatched<Record<string, unknown> | readonly unknown[]>(
    client,
    addrs.map((addr) => ({ ...registry, functionName: "get", args: [addr] })),
    { allowFailure: true },
  );
  const out: QuoteAsset[] = [];
  for (let i = 0; i < addrs.length; i++) {
    const raw = assets[i];
    if (!raw) continue;
    const rec = Array.isArray(raw)
      ? {
          token: raw[0],
          symbol: raw[1],
          name: raw[2],
          decimals: raw[3],
          icon: raw[4],
          category: raw[5],
          enabled: raw[6],
          exists: raw[7],
          buybackRouteEnabled: raw[9],
          usdPegOne: raw[12],
        }
      : (raw as Record<string, unknown>);
    if (!rec.enabled) continue;
    if (rec.buybackRouteEnabled === false) continue;
    out.push(quoteAssetRowToQuote({ ...rec, token: rec.token ?? addrs[i] }));
  }
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
  const inject = useQaInject();
  return useQuery({
    queryKey: [...qk.quoteAssets, inject],
    enabled: !!client || REVIEW_FIXTURES || inject === "rpc",
    staleTime: QUOTE_ASSETS_STALE_MS,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    queryFn: async ({ signal }) => {
      if (inject === "rpc") {
        throw new ServiceUnavailableError("rpc", FAILURE_COPY.rpc.body);
      }
      try {
        const items = await loadQuoteAssets(signal);
        if (items.length) return items;
        if (REVIEW_FIXTURES) return REVIEW_QUOTES;
        if (!client) throw new Error("no client");
        return await readQuotesRpc(client);
      } catch (e) {
        if (e instanceof ServiceUnavailableError) throw e;
        if (REVIEW_FIXTURES) return REVIEW_QUOTES;
        throw new ServiceUnavailableError("rpc", e instanceof Error ? e.message : FAILURE_COPY.rpc.body);
      }
    },
    refetchInterval: 15_000,
  });
}

export function useLaunchTokens(opts: MarketListOpts = {}, flags?: { enabled?: boolean }) {
  const inject = useQaInject();
  return useQuery({
    queryKey: [...qk.markets(opts), inject],
    enabled: flags?.enabled !== false,
    queryFn: async ({ signal }) => {
      if (inject === "indexer") {
        throw new ServiceUnavailableError("indexer", FAILURE_COPY.indexer.body);
      }
      if (inject === "empty") return [] as LaunchToken[];
      return loadLaunchList(opts, signal);
    },
    staleTime: INDEXED_STALE_MS,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    refetchInterval: 8_000,
  });
}

export function useMarket(address?: string) {
  const inject = useQaInject();
  return useQuery({
    queryKey: [...qk.market(address), inject],
    enabled: !!address && inject !== "token-invalid",
    queryFn: async ({ signal }) => {
      if (inject === "indexer") {
        throw new ServiceUnavailableError("indexer", FAILURE_COPY.indexer.body);
      }
      if (inject === "token-invalid" || !address) return undefined;
      return loadOneMarket(address, signal);
    },
    staleTime: INDEXED_STALE_MS,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    refetchInterval: 8_000,
  });
}

export function useTokenPage(address?: string, interval: string = "5m") {
  const inject = useQaInject();
  return useQuery({
    queryKey: [...qk.tokenPage(address, interval), inject],
    enabled: !!address && inject !== "token-invalid",
    queryFn: async ({ signal }) => {
      const empty = { market: undefined, ohlcv: { candles: [] as CandlePoint[], sparse: true, interval }, swaps: [] };
      if (!address || inject === "token-invalid") return empty;
      if (inject === "indexer") {
        throw new ServiceUnavailableError("indexer", FAILURE_COPY.indexer.body);
      }
      if (inject === "empty") return empty;
      return loadTokenPage(address, interval, signal);
    },
    staleTime: INDEXED_STALE_MS,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    refetchInterval: 8_000,
  });
}

export function useCoreStats() {
  const client = usePublicClient();
  const inject = useQaInject();
  return useQuery({
    queryKey: [...qk.coreStats, inject],
    enabled: !!client || inject === "rpc",
    staleTime: CORE_STALE_MS,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    queryFn: async ({ signal }) => {
      if (inject === "rpc") {
        throw new ServiceUnavailableError("rpc", FAILURE_COPY.rpc.body);
      }
      if (!client) throw new ServiceUnavailableError("rpc", FAILURE_COPY.rpc.body);
      return readCoreStatsBatched(client, core, buyback, addresses.USDC, signal);
    },
    refetchInterval: 8_000,
  });
}

export function useIndexerHealth() {
  return useQuery({
    queryKey: qk.indexer,
    queryFn: async ({ signal }) => {
      const got = await fetchIndexerJson<{ ok: boolean; block?: number }>("/health", { signal });
      if (!got.ok) return { ok: false };
      return got.body;
    },
    refetchInterval: 10_000,
  });
}

export function useCandles(token?: string, interval: string = "5m") {
  const inject = useQaInject();
  return useQuery({
    queryKey: [...qk.candles(token, interval), inject],
    enabled: !!token,
    staleTime: INDEXED_STALE_MS,
    queryFn: async ({ signal }) => {
      if (inject === "indexer") {
        throw new ServiceUnavailableError("indexer", FAILURE_COPY.indexer.body);
      }
      if (inject === "empty") return { candles: [] as CandlePoint[], sparse: true, interval };
      return loadCandles(token!, interval, signal);
    },
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    refetchInterval: 8_000,
  });
}

export function useSwapSeries(token?: string) {
  const inject = useQaInject();
  return useQuery({
    queryKey: [...qk.swaps(token), inject],
    enabled: !!token,
    staleTime: INDEXED_STALE_MS,
    queryFn: async ({ signal }) => {
      if (inject === "indexer") {
        throw new ServiceUnavailableError("indexer", FAILURE_COPY.indexer.body);
      }
      if (inject === "empty") return [];
      return loadSwaps(token!, signal);
    },
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    refetchInterval: 8_000,
  });
}

export function useReactorEvents() {
  const inject = useQaInject();
  return useQuery({
    queryKey: [...qk.reactorEvents, inject],
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    queryFn: async ({ signal }) => {
      if (inject === "indexer") {
        throw new ServiceUnavailableError("indexer", FAILURE_COPY.indexer.body);
      }
      return loadReactorEvents(signal);
    },
    refetchInterval: 8_000,
  });
}

export function useTokenByAddress(address?: string) {
  const inject = useQaInject();
  const { data, ...rest } = useMarket(address);
  const token_ = useMemo(() => (inject === "token-invalid" ? undefined : data), [data, inject]);
  return { data: token_, ...rest };
}

export function usePendingRewards(tokens: LaunchToken[] | undefined, account?: string) {
  const client = usePublicClient();
  return useQuery({
    queryKey: [...qk.rewards(account), (tokens ?? []).map((t) => t.token.toLowerCase())],
    enabled: !!tokens,
    staleTime: INDEXED_STALE_MS,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    queryFn: async ({ signal }) => {
      const list = tokens ?? [];
      if (!account || !client) {
        return list.map((t) => ({
          token: t.token,
          symbol: t.symbol,
          quote: t.quoteSymbol ?? "",
          pending: 0n,
          dec: t.quoteDecimals ?? 18,
        }));
      }
      const pending = await readPendingRewardsPage(
        client,
        list.map((t) => t.token),
        account as `0x${string}`,
        signal,
      );
      return list.map((t, i) => ({
        token: t.token,
        symbol: t.symbol,
        quote: t.quoteSymbol ?? "",
        pending: pending[i] ?? 0n,
        dec: t.quoteDecimals ?? 18,
      }));
    },
    refetchInterval: 8_000,
  });
}

export function useTickerStatus(raw: string) {
  const trimmed = raw.trim();
  return useQuery({
    queryKey: qk.ticker(trimmed),
    enabled: trimmed.length > 0,
    staleTime: 5_000,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    queryFn: ({ signal }) => loadTickerStatus(trimmed, signal),
  });
}

export function useWalletSnapshot(account?: `0x${string}`) {
  const client = usePublicClient();
  return useQuery({
    queryKey: qk.wallet(account),
    enabled: !!account && !!client,
    staleTime: INDEXED_STALE_MS,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    queryFn: ({ signal }) =>
      readWalletSnapshot(client!, {
        owner: account!,
        usdc: addresses.USDC,
        core: (addresses.CoreToken ?? addresses.TestCORE) as `0x${string}`,
        spender: addresses.ReactorRouter,
        signal,
      }),
    refetchInterval: 15_000,
  });
}

export function useTicketWallet(
  opts: {
    token?: `0x${string}`;
    quote?: `0x${string}`;
    spender?: `0x${string}`;
    payAsset?: `0x${string}`;
    account?: `0x${string}`;
    side?: string;
  },
) {
  const client = usePublicClient();
  return useQuery({
    queryKey: qk.ticketWallet(opts.account, opts.token, opts.side),
    enabled: !!opts.account && !!opts.token && !!opts.quote && !!opts.spender && !!opts.payAsset && !!client,
    staleTime: INDEXED_STALE_MS,
    refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
    queryFn: ({ signal }) =>
      readTicketWallet(client!, {
        owner: opts.account!,
        quote: opts.quote!,
        token: opts.token!,
        spender: opts.spender!,
        payAsset: opts.payAsset!,
        signal,
      }),
    refetchInterval: 8_000,
  });
}
