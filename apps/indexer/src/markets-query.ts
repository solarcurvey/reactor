import type { Store } from "./db.ts";
import { parseBoard } from "./markets-metrics.ts";

export type MarketSort = "new" | "vol" | "price";

export type MarketCursor = { cursor_ts: string; cursor_token: string };

const MARKET_SELECT = `SELECT m.token,m.quote,m.pool_id,m.stage,m.market_live,m.fair_id,m.bonding_bps,m.real_quote,m.grad_target,m.price_quote_x18,m.price_usd6,m.fdv_usd6,m.volume_24h_quote,m.volume_24h_usd6,m.trades_24h,m.liquidity_usd6,m.change_24h_bps,m.lifetime_rewards,m.image,m.description,m.updated_ts,
              t.symbol,t.name,t.decimals,t.creator,t.ticker,t.factory_version,t.rewards_mode,t.supply,t.current_supply,t.mode,
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
  return `WHERE (?='' OR lower(COALESCE(t.symbol,'')) LIKE ? OR lower(COALESCE(t.name,'')) LIKE ? OR m.token LIKE ? OR lower(COALESCE(t.ticker,'')) LIKE ? OR lower(COALESCE(q.symbol,'')) LIKE ?)
      AND (?='' OR m.stage=?)
      AND (?='' OR m.quote=?)
      AND (?='' OR CAST(COALESCE(t.mode,0) AS TEXT)=?)
      AND (?='' OR CAST(COALESCE(t.rewards_mode,1) AS TEXT)=?)
      AND (?='' OR lower(COALESCE(q.symbol,''))=?)
      AND (?='' OR m.market_live=1 OR m.stage IN ('bonding','ready'))${keyset}`;
}

function filterParams(opts: {
  q: string;
  like: string;
  stageSql: string;
  quote: string;
  mode: string;
  rewards: string;
  quoteSymbol: string;
  live: string;
}): unknown[] {
  const { q, like, stageSql, quote, mode, rewards, quoteSymbol, live } = opts;
  return [
    q, like, like, like, like, like,
    stageSql, stageSql,
    quote, quote,
    mode, mode,
    rewards, rewards,
    quoteSymbol, quoteSymbol,
    live,
  ];
}

export function normalizeMarketToken(raw: string | null | undefined): `0x${string}` | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(s)) return null;
  return s as `0x${string}`;
}

export async function getMarket(store: Store, token: string): Promise<Record<string, unknown> | null> {
  const addr = normalizeMarketToken(token);
  if (!addr) return null;
  const row = await store.get<Record<string, unknown>>(`${MARKET_SELECT} WHERE m.token=?`, addr);
  return row ?? null;
}

export type ListMarketsOpts = {
  q?: string;
  stage?: string;
  quote?: string;
  board?: string | null;
  mode?: string | null;
  rewards?: string | null;
  quoteSymbol?: string | null;
  live?: string | null;
  sort?: string | null;
  limit?: number;
  cursorTs?: string | null;
  cursorToken?: string;
  offset?: number;
};

export type MarketsPage = {
  items: Record<string, unknown>[];
  total: number;
  volume_24h_usd6_total: string;
  next_cursor: MarketCursor | null;
  has_more: boolean;
  sort: MarketSort;
};

export async function listMarkets(
  store: Store,
  opts: ListMarketsOpts = {},
): Promise<MarketsPage> {
  const q = (opts.q ?? "").toLowerCase();
  const quote = (opts.quote ?? "").toLowerCase();
  const board = parseBoard(opts.board);
  const sort = parseMarketSort(opts.sort || board.sortHint || undefined);
  const limit = Math.min(100, Math.max(1, Number(opts.limit ?? 40)));
  const cursorTs = opts.cursorTs ?? null;
  const cursorToken = (opts.cursorToken ?? "").toLowerCase();
  const offset = cursorTs == null ? Math.max(0, Number(opts.offset ?? 0)) : 0;
  const like = `%${q}%`;
  const rawStage = opts.stage ?? "";
  const stageSql =
    rawStage === "bonding" || board.stage === "bonding"
      ? "bonding"
      : rawStage === "v4" || rawStage === "trending"
        ? "v4"
        : "";
  const mode = String(opts.mode ?? board.mode);
  const rewards = String(opts.rewards ?? board.rewards);
  const quoteSymbol = (opts.quoteSymbol ?? board.quoteSymbol).toLowerCase();
  const live = String(opts.live ?? board.live);
  const order = marketOrderSql(sort);
  const keyset = cursorTs != null ? marketKeysetSql(sort) : "";
  const where = marketFilterSql(keyset);
  const base = filterParams({ q, like, stageSql, quote, mode, rewards, quoteSymbol, live });
  const params: unknown[] = [...base];
  if (cursorTs != null) params.push(cursorTs, cursorToken);
  const totals = await store.get<{ n: number; vol: string }>(
    `SELECT COUNT(*) as n, COALESCE(SUM(CAST(COALESCE(m.volume_24h_usd6,'0') AS NUMERIC)),0) as vol
     FROM markets m LEFT JOIN tokens t ON t.address=m.token LEFT JOIN quote_assets q ON q.token=m.quote
     ${where.replace(keyset, "")}`,
    ...base,
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
  const next = items.length === limit ? nextMarketCursor(sort, items[items.length - 1]) : null;
  return {
    items,
    total: Number(totals?.n ?? 0),
    volume_24h_usd6_total: String(totals?.vol ?? "0").split(".")[0] ?? "0",
    next_cursor: next,
    has_more: Boolean(next && items.length === limit),
    sort,
  };
}

export async function listFeaturedMarkets(store: Store): Promise<{
  bonding: Record<string, unknown> | null;
  volume: Record<string, unknown> | null;
}> {
  const bonding =
    (await store.get<Record<string, unknown>>(
      `${MARKET_SELECT}
       WHERE m.stage='bonding' AND COALESCE(m.market_live,0)=0
       ORDER BY COALESCE(m.bonding_bps,0) DESC, m.token DESC
       LIMIT 1`,
    )) ?? null;
  const skip = String(bonding?.token ?? "");
  const volume =
    (await store.get<Record<string, unknown>>(
      `${MARKET_SELECT}
       WHERE (m.market_live=1 OR m.stage IN ('bonding','ready'))
         AND (?='' OR m.token!=?)
       ORDER BY CAST(COALESCE(m.volume_24h_usd6,'0') AS NUMERIC) DESC, m.token DESC
       LIMIT 1`,
      skip,
      skip,
    )) ?? null;
  return { bonding, volume };
}
