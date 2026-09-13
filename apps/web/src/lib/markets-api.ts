import type { LaunchToken } from "./hooks";
import { INDEXER_URL } from "./chain";
import type { BoardFilter } from "./market-ui";

export const MARKETS_PAGE_SIZE = 24;

export type MarketCursor = { cursor_ts: string; cursor_token: string };

export type MarketsPage = {
  items: LaunchToken[];
  raw: Record<string, unknown>[];
  total: number;
  volume24hUsd6Total: string;
  sort: string;
  next_cursor: MarketCursor | null;
  has_more: boolean;
};

export function boardToQuery(filter: BoardFilter): {
  board: string;
  sort?: "new" | "vol" | "price";
} {
  switch (filter) {
    case "Trending":
      return { board: "trending", sort: "vol" };
    case "Bonding":
      return { board: "bonding" };
    case "Rewards":
      return { board: "rewards" };
    case "Buy+Burn":
      return { board: "buy+burn" };
    case "Batch Fair":
      return { board: "fair" };
    case "USDC-quoted":
      return { board: "usdc-quoted" };
    default:
      return { board: "new", sort: "new" };
  }
}

export function marketsSearchParams(opts: {
  q?: string;
  board?: BoardFilter;
  quote?: string;
  quoteSymbol?: string;
  stage?: string;
  sort?: "new" | "vol" | "price";
  limit?: number;
  cursor?: MarketCursor | null;
}): URLSearchParams {
  const u = new URLSearchParams();
  const mapped = opts.board ? boardToQuery(opts.board) : undefined;
  if (opts.q?.trim()) u.set("q", opts.q.trim());
  if (mapped?.board) u.set("board", mapped.board);
  if (opts.quote) u.set("quote", opts.quote);
  if (opts.quoteSymbol) u.set("quote_symbol", opts.quoteSymbol);
  if (opts.stage) u.set("stage", opts.stage);
  const sort = opts.sort ?? mapped?.sort;
  if (sort) u.set("sort", sort);
  u.set("limit", String(opts.limit ?? MARKETS_PAGE_SIZE));
  if (opts.cursor?.cursor_ts != null && opts.cursor.cursor_token) {
    u.set("cursor_ts", opts.cursor.cursor_ts);
    u.set("cursor_token", opts.cursor.cursor_token);
  }
  return u;
}

export function marketsUrl(opts: Parameters<typeof marketsSearchParams>[0]): string {
  return `${INDEXER_URL}/markets?${marketsSearchParams(opts).toString()}`;
}

/** True when a client-side filter of `page1` would miss `needle` (the AC regression). */
export function searchMissesIfClientFiltered(
  page1Symbols: string[],
  needleSymbol: string,
  backendHits: string[],
): boolean {
  return !page1Symbols.includes(needleSymbol) && backendHits.includes(needleSymbol);
}
