import { QueryCache, QueryClient } from "@tanstack/react-query";
import { EXPENSIVE_REFETCH_ON_FOCUS } from "./page-budget";
import { ServiceUnavailableError } from "./qa-inject";
import { reportFailure, type FailureKind } from "./obs";

function queryKind(queryKey: readonly unknown[]): FailureKind {
  const head = String(queryKey[0] ?? "");
  if (head === "quotes" || head === "quote-assets" || head === "core-stats") return "rpc";
  return "api";
}

/** Catalog / board data. Live `POST /quote` tickets are not cached here. */
export const INDEXED_STALE_MS = 4_000;
export const QUOTE_ASSETS_STALE_MS = 15_000;
export const CORE_STALE_MS = 5_000;
export { EXPENSIVE_REFETCH_ON_FOCUS };

export type MarketListOpts = {
  q?: string;
  stage?: string;
  quote?: string;
  sort?: "new" | "vol" | "price";
  limit?: number;
};

export const qk = {
  markets: (opts: MarketListOpts = {}) => ["markets", opts] as const,
  market: (token?: string) => ["market", token?.toLowerCase()] as const,
  tokenPage: (token?: string, interval?: string) => ["token-page", token?.toLowerCase(), interval] as const,
  quoteAssets: ["quote-assets"] as const,
  candles: (token?: string, interval?: string) => ["candles", token?.toLowerCase(), interval] as const,
  swaps: (token?: string) => ["swaps", token?.toLowerCase()] as const,
  coreStats: ["core-stats"] as const,
  coreVesting: (addr?: string) => ["core-vesting", addr] as const,
  indexer: ["indexer"] as const,
  rewards: (account?: string) => ["rewards", account?.toLowerCase()] as const,
  ticker: (raw: string) => ["ticker", raw] as const,
  reactorEvents: ["reactor-events"] as const,
  top10: ["reactor-top10-api"] as const,
  wallet: (account?: string) => ["wallet", account?.toLowerCase()] as const,
  ticketWallet: (account?: string, token?: string, side?: string) =>
    ["ticket-wallet", account?.toLowerCase(), token?.toLowerCase(), side] as const,
};

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (error instanceof ServiceUnavailableError) return;
        reportFailure(queryKind(query.queryKey), error, {
          queryKey: query.queryKey.map((k) => String(k)).slice(0, 6),
        });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: INDEXED_STALE_MS,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: EXPENSIVE_REFETCH_ON_FOCUS,
        retry: (count, err) => {
          if (err instanceof ServiceUnavailableError) return false;
          return count < 1;
        },
      },
    },
  });
}
