import type { Store } from "./db.ts";

export type MarketSort = "new" | "vol" | "price";

export type MarketCursor = { cursor_ts: string; cursor_token: string };

const MARKET_SELECT = `SELECT m.token,m.quote,m.pool_id,m.stage,m.market_live,m.fair_id,m.bonding_bps,m.real_quote,m.grad_target,m.price_quote_x18,m.price_usd6,m.fdv_usd6,m.volume_24h_quote,m.volume_24h_usd6,m.trades_24h,m.lifetime_rewards,m.image,m.description,m.updated_ts,
              t.symbol,t.name,t.decimals,t.creator,t.ticker,t.factory_version,t.rewards_mode,t.supply,t.current_supply,
              q.symbol as quote_symbol, q.decimals as quote_decimals
       FROM markets m
       LEFT JOIN tokens t ON t.address=m.token
       LEFT JOIN quote_assets q ON q.token=m.quote`;

/** `cursor_ts` is the sort key (timestamp, volume, or price) — name is historical. */
export function parseMarketSort(raw: string | null | undefined): MarketSort {
  if (raw === "vol" || raw === "price") return raw;
  return "new";
}

export function marketOrderSql(sort: MarketSort): string {
  switch (sort) {
    case "vol":
      return "CAST(m.volume_24h_usd6 AS NUMERIC) DESC, m.token DESC";
    case "price":
      return "CAST(m.price_usd6 AS NUMERIC) DESC, m.token DESC";
    default:
      return "m.updated_ts DESC, m.token DESC";
  }
}

/** Row-value keyset must use the same columns as `marketOrderSql`. */
export function marketKeysetSql(sort: MarketSort): string {
  switch (sort) {
    case "vol":
      return " AND (CAST(m.volume_24h_usd6 AS NUMERIC), m.token) < (CAST(? AS NUMERIC), ?)";
    case "price":
      return " AND (CAST(m.price_usd6 AS NUMERIC), m.token) < (CAST(? AS NUMERIC), ?)";
    default:
      return " AND (m.updated_ts, m.token) < (?, ?)";
  }
}

export function marketCursorValue(
  sort: MarketSort,
  row: { volume_24h_usd6?: unknown; price_usd6?: unknown; updated_ts?: unknown },
): string {
  switch (sort) {
    case "vol":
      return String(row.volume_24h_usd6 ?? "0");
    case "price":
      return String(row.price_usd6 ?? "0");
    default:
      return String(row.updated_ts ?? 0);
  }
}

export function nextMarketCursor(
  sort: MarketSort,
  last: { token?: unknown; volume_24h_usd6?: unknown; price_usd6?: unknown; updated_ts?: unknown } | undefined,
): MarketCursor | null {
  if (!last) return null;
  return { cursor_ts: marketCursorValue(sort, last), cursor_token: String(last.token ?? "") };
}

export function marketFilterSql(keyset: string): string {
  return `WHERE (?='' OR lower(COALESCE(t.symbol,'')) LIKE ? OR lower(COALESCE(t.name,'')) LIKE ? OR m.token LIKE ? OR lower(COALESCE(t.ticker,'')) LIKE ?)
      AND (?='' OR m.stage=?)
      AND (?='' OR m.quote=?)${keyset}`;
}

export type ListMarketsOpts = {
  q?: string;
  stage?: string;
  quote?: string;
  sort?: string | null;
  limit?: number;
  cursorTs?: string | null;
  cursorToken?: string;
  offset?: number;
};

export async function listMarkets(
  store: Store,
  opts: ListMarketsOpts = {},
): Promise<{ items: Record<string, unknown>[]; total: number; next_cursor: MarketCursor | null; sort: MarketSort }> {
  const q = (opts.q ?? "").toLowerCase();
  const quote = (opts.quote ?? "").toLowerCase();
  const sort = parseMarketSort(opts.sort);
  const limit = Math.min(100, Math.max(1, Number(opts.limit ?? 40)));
  const cursorTs = opts.cursorTs ?? null;
  const cursorToken = (opts.cursorToken ?? "").toLowerCase();
  const offset = cursorTs == null ? Math.max(0, Number(opts.offset ?? 0)) : 0;
  const like = `%${q}%`;
  const stage = opts.stage ?? "";
  const stageSql = stage === "bonding" ? "bonding" : stage === "v4" || stage === "trending" ? "v4" : "";
  const order = marketOrderSql(sort);
  const keyset = cursorTs != null ? marketKeysetSql(sort) : "";
  const where = marketFilterSql(keyset);
  const params: unknown[] = [q, like, like, like, like, stageSql, stageSql, quote, quote];
  if (cursorTs != null) params.push(cursorTs, cursorToken);
  const total = await store.get<{ n: number }>(
    `SELECT COUNT(*) as n FROM markets m LEFT JOIN tokens t ON t.address=m.token ${where.replace(keyset, "")}`,
    q,
    like,
    like,
    like,
    like,
    stageSql,
    stageSql,
    quote,
    quote,
  );
  const items = await store.all<Record<string, unknown>>(
    `${MARKET_SELECT}
       ${where}
       ORDER BY ${order}
       LIMIT ?${cursorTs == null && offset ? " OFFSET ?" : ""}`,
    ...params,
    limit,
    ...(cursorTs == null && offset ? [offset] : []),
  );
  return {
    items,
    total: Number(total?.n ?? 0),
    next_cursor: nextMarketCursor(sort, items[items.length - 1]),
    sort,
  };
}
