import { throwIfAborted } from "./abort";
import { CATEGORY_LABELS } from "./addresses";
import { INDEXER_URL } from "./chain";
import type { MarketListOpts } from "./query";
import { FIXTURE_REACTOR_EVENTS, FIXTURE_TOKENS, FIXTURE_XSS_SWAPS, REVIEW_FIXTURES } from "./review-fixtures";
import { sanitizeAddress, sanitizeLaunchFields } from "./untrusted-metadata";

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
  ticker?: string;
  decimals: number;
  supply: bigint;
  currentSupply?: bigint;
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
  priceQuoteX18?: string;
  fdvUsd6?: string;
  volume24hUsd6?: string;
};

export async function fetchIndexerJson<T>(path: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false }> {
  throwIfAborted(init?.signal);
  try {
    const res = await fetch(`${INDEXER_URL}${path}`, init);
    throwIfAborted(init?.signal);
    if (!res?.ok) return { ok: false };
    return { ok: true, body: (await res.json()) as T };
  } catch (e) {
    throwIfAborted(init?.signal);
    if (e instanceof Error && e.name === "AbortError") throw e;
    return { ok: false };
  }
}

export function quoteAssetRowToQuote(row: Record<string, unknown>): QuoteAsset {
  const symbol = String(row.symbol ?? "");
  const category = Number(row.category ?? 0);
  const enabled = row.enabled === true || Number(row.enabled) === 1;
  return {
    token: String(row.token ?? "") as `0x${string}`,
    symbol,
    name: String(row.name ?? symbol),
    decimals: Number(row.decimals ?? 18),
    icon: String(row.icon ?? ""),
    category,
    categoryLabel: CATEGORY_LABELS[category] ?? "Other",
    enabled,
    exists: row.exists === false || Number(row.exists) === 0 ? false : true,
    usdPegOne: Boolean(row.usdPegOne ?? row.usd_peg_one) || symbol === "USDC",
  };
}

function cleanLaunch(t: LaunchToken): LaunchToken {
  const cleaned = sanitizeLaunchFields(t);
  const token = (sanitizeAddress(cleaned.token) || sanitizeAddress(t.token) || "") as `0x${string}`;
  return {
    ...t,
    ...cleaned,
    token,
    symbol: cleaned.symbol || t.symbol,
  };
}

export function marketRowToLaunch(m: Record<string, unknown>): LaunchToken {
  const fairId = BigInt(String(m.fair_id ?? m.fairId ?? 0));
  return cleanLaunch({
    token: String(m.token ?? m.address) as `0x${string}`,
    quote: String(m.quote ?? "0x") as `0x${string}`,
    creator: String(m.creator ?? "0x") as `0x${string}`,
    mode: Number(m.mode ?? (fairId > 0n ? 1 : 0)),
    poolId: String(m.pool_id ?? m.poolId ?? "0x") as `0x${string}`,
    marketLive: Boolean(m.market_live ?? m.marketLive),
    fairId,
    name: String(m.name ?? "Token"),
    symbol: String(m.symbol ?? "TKN"),
    ticker: String(m.ticker ?? m.symbol ?? ""),
    decimals: Number(m.decimals ?? 18),
    supply: BigInt(String(m.current_supply || m.supply || "0")),
    currentSupply: BigInt(String(m.current_supply || m.supply || "0")),
    image: String(m.image ?? ""),
    description: String(m.description ?? ""),
    website: "",
    twitter: "",
    telegram: "",
    quoteSymbol: String(m.quote_symbol ?? m.quoteSymbol ?? ""),
    quoteDecimals: Number(m.quote_decimals ?? m.quoteDecimals ?? 18),
    lifetimeRewards: BigInt(String(m.lifetime_rewards || "0")),
    rewardsMode: Number(m.rewards_mode ?? 1) !== 0,
    bonding: String(m.stage) === "bonding",
    bondingBps: Number(m.bonding_bps ?? 0),
    realQuote: BigInt(String(m.real_quote || "0")),
    gradTarget: BigInt(String(m.grad_target || "0")),
    ready: String(m.stage) === "ready",
    curve: undefined,
    priceQuoteX18: String(m.price_quote_x18 ?? "0"),
    fdvUsd6: String(m.fdv_usd6 ?? "0"),
    volume24hUsd6: String(m.volume_24h_usd6 ?? "0"),
  });
}

export function mergeLaunchFixtures(items: LaunchToken[]): LaunchToken[] {
  if (!REVIEW_FIXTURES) return items;
  const fixturesByAddr = new Map(FIXTURE_TOKENS.map((t) => [t.token.toLowerCase(), t]));
  const merged = items.map((t) => {
    const f = fixturesByAddr.get(t.token.toLowerCase());
    if (!f) return t;
    const emptyPx = !t.priceQuoteX18 || t.priceQuoteX18 === "0";
    const emptyVol = !t.volume24hUsd6 || t.volume24hUsd6 === "0";
    const emptyFdv = !t.fdvUsd6 || t.fdvUsd6 === "0";
    const emptyRewards = !t.lifetimeRewards || t.lifetimeRewards === 0n;
    return cleanLaunch({
      ...t,
      name: t.name && t.name !== "Token" ? t.name : f.name,
      symbol: t.symbol && t.symbol !== "TKN" ? t.symbol : f.symbol,
      ticker: t.ticker || f.ticker || f.symbol,
      quoteSymbol: t.quoteSymbol || f.quoteSymbol,
      quoteDecimals: t.quoteDecimals || f.quoteDecimals,
      image: t.image || f.image,
      description: t.description || f.description,
      website: t.website || f.website,
      twitter: t.twitter || f.twitter,
      telegram: t.telegram || f.telegram,
      priceQuoteX18: emptyPx ? f.priceQuoteX18 : t.priceQuoteX18,
      fdvUsd6: emptyFdv ? f.fdvUsd6 : t.fdvUsd6,
      volume24hUsd6: emptyVol ? f.volume24hUsd6 : t.volume24hUsd6,
      lifetimeRewards: emptyRewards ? f.lifetimeRewards : t.lifetimeRewards,
      bonding: t.bonding || f.bonding,
      bondingBps: t.bondingBps || f.bondingBps,
    });
  });
  const seen = new Set(merged.map((t) => t.token.toLowerCase()));
  return [...merged, ...FIXTURE_TOKENS.filter((t) => !seen.has(t.token.toLowerCase())).map(cleanLaunch)];
}

export function marketsQueryPath(opts: MarketListOpts = {}): string {
  const u = new URL("/markets", "http://indexer.local");
  if (opts.q) u.searchParams.set("q", opts.q);
  if (opts.stage && opts.stage !== "all") u.searchParams.set("stage", opts.stage);
  if (opts.quote) u.searchParams.set("quote", opts.quote);
  if (opts.sort) u.searchParams.set("sort", opts.sort);
  u.searchParams.set("limit", String(opts.limit ?? 80));
  return `${u.pathname}${u.search}`;
}

export async function loadLaunchList(opts: MarketListOpts = {}, signal?: AbortSignal): Promise<LaunchToken[]> {
  const got = await fetchIndexerJson<{ items?: Record<string, unknown>[] }>(marketsQueryPath(opts), { signal });
  if (got.ok) {
    const items = (got.body.items ?? []).map(marketRowToLaunch).filter((t) => sanitizeAddress(t.token));
    const merged = mergeLaunchFixtures(items);
    if (merged.length) return merged;
  }
  if (REVIEW_FIXTURES) return FIXTURE_TOKENS.map(cleanLaunch);
  return [];
}

export async function loadOneMarket(address: string, signal?: AbortSignal): Promise<LaunchToken | undefined> {
  const got = await fetchIndexerJson<{ item?: Record<string, unknown> }>(`/markets/${address}`, { signal });
  if (got.ok && got.body.item) {
    const row = marketRowToLaunch(got.body.item);
    if (REVIEW_FIXTURES) return mergeLaunchFixtures([row])[0];
    return row;
  }
  if (REVIEW_FIXTURES) {
    const fixture = FIXTURE_TOKENS.find((t) => t.token.toLowerCase() === address.toLowerCase());
    return fixture ? cleanLaunch(fixture) : undefined;
  }
  return undefined;
}

export type CandlePoint = { t: number; o: string; h: string; l: string; c: string; v: string; n: number };

export function fixtureCandles(intervalSec: number): CandlePoint[] {
  const now = Math.floor(Date.now() / 1000);
  const start = now - intervalSec * 16;
  const out: CandlePoint[] = [];
  let px = 2n * 10n ** 16n;
  for (let i = 0; i < 16; i++) {
    const t = start + i * intervalSec;
    px += BigInt(i) * 10n ** 13n;
    const s = px.toString();
    out.push({ t, o: s, h: s, l: s, c: s, v: i % 3 === 0 ? "0" : "100000000", n: i % 3 === 0 ? 0 : 1 });
  }
  return out;
}

export type SwapRow = {
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
};

const FIXTURE_SWAPS: SwapRow[] = [
  { t: 1, notional: "1000000000", holders: "20000000", buyback: "15000000", flywheel: "10000000", coreAmt: "5000000", sqrtPrice: "79228162514264337593543950336" },
  { t: 2, notional: "2000000000", holders: "40000000", buyback: "30000000", flywheel: "20000000", coreAmt: "10000000", sqrtPrice: "85000000000000000000000000000" },
  { t: 3, notional: "800000000", holders: "16000000", buyback: "12000000", flywheel: "8000000", coreAmt: "4000000", sqrtPrice: "91000000000000000000000000000" },
];

export function emptyOhlcv(interval: string) {
  return { candles: [] as CandlePoint[], sparse: true, interval };
}

export async function loadTokenPage(address: string, interval: string, signal?: AbortSignal) {
  const got = await fetchIndexerJson<{
    ok?: boolean;
    market?: Record<string, unknown>;
    candles?: CandlePoint[];
    swaps?: SwapRow[];
    interval?: string;
    sparse?: boolean;
  }>(`/page/token/${address}?interval=${encodeURIComponent(interval)}`, { signal });
  if (got.ok && got.body.ok && got.body.market) {
    const candles = got.body.candles ?? [];
    return {
      market: marketRowToLaunch(got.body.market),
      ohlcv: { candles, sparse: Boolean(got.body.sparse), interval: got.body.interval ?? interval },
      swaps: got.body.swaps ?? [],
    };
  }
  const [market, ohlcv, swaps] = await Promise.all([
    loadOneMarket(address, signal),
    loadCandles(address, interval, signal),
    loadSwaps(address, signal),
  ]);
  if (!market && !REVIEW_FIXTURES) return { market: undefined, ohlcv, swaps };
  return {
    market: market ?? FIXTURE_TOKENS.find((t) => t.token.toLowerCase() === address.toLowerCase()),
    ohlcv,
    swaps,
  };
}

export async function loadCandles(token: string, interval: string, signal?: AbortSignal) {
  const empty = emptyOhlcv(interval);
  const got = await fetchIndexerJson<{ candles?: CandlePoint[]; interval?: string }>(
    `/candles/${token}?interval=${encodeURIComponent(interval)}`,
    { signal },
  );
  if (!got.ok) {
    if (!REVIEW_FIXTURES) return empty;
    const candles = fixtureCandles(
      interval === "1m" ? 60 : interval === "15m" ? 900 : interval === "1h" ? 3600 : interval === "4h" ? 14400 : interval === "1d" ? 86400 : 300,
    );
    return { candles, sparse: candles.filter((c) => c.n > 0).length < 3, interval };
  }
  const candles = got.body.candles ?? [];
  const real = candles.filter((c) => c.n > 0).length;
  if (REVIEW_FIXTURES && candles.length === 0) {
    const fb = fixtureCandles(300);
    return { candles: fb, sparse: fb.filter((c) => c.n > 0).length < 3, interval };
  }
  return { candles, sparse: real === 0 || real < 3, interval: got.body.interval ?? interval };
}

export async function loadSwaps(token: string, signal?: AbortSignal): Promise<SwapRow[]> {
  const got = await fetchIndexerJson<SwapRow[]>(`/swaps/${token}`, { signal });
  const fixtures = [...FIXTURE_SWAPS, ...FIXTURE_XSS_SWAPS];
  if (!got.ok) return REVIEW_FIXTURES ? fixtures : [];
  if (REVIEW_FIXTURES && got.body.length === 0) return fixtures;
  return REVIEW_FIXTURES ? [...got.body, ...FIXTURE_XSS_SWAPS] : got.body;
}

export async function loadQuoteAssets(signal?: AbortSignal): Promise<QuoteAsset[]> {
  const got = await fetchIndexerJson<{ items?: Record<string, unknown>[] }>("/quote-assets", { signal });
  if (!got.ok) return [];
  return (got.body.items ?? []).map(quoteAssetRowToQuote).filter((q) => q.enabled);
}

export async function loadTickerStatus(raw: string, signal?: AbortSignal): Promise<string> {
  const got = await fetchIndexerJson<{
    ticker?: string;
    reserved?: boolean;
    available?: boolean;
    error?: string;
  }>(`/ticker/${encodeURIComponent(raw)}`, { signal });
  if (!got.ok) return "Ticker status offline";
  return tickerStatusLabel(got.body);
}

export async function loadReactorEvents(signal?: AbortSignal) {
  const got = await fetchIndexerJson<{ events: { name: string; token: string; payload: string; block: number; tx: string }[] }>(
    "/reactor",
    { signal },
  );
  const empty = { events: [] as { name: string; token: string; payload: string; block: number; tx: string }[] };
  if (!got.ok) return REVIEW_FIXTURES ? { events: FIXTURE_REACTOR_EVENTS } : empty;
  if (REVIEW_FIXTURES) return { events: [...FIXTURE_REACTOR_EVENTS, ...(got.body.events ?? [])] };
  return got.body;
}

export async function loadTop10(signal?: AbortSignal) {
  const got = await fetchIndexerJson<{ rows?: unknown[]; pauseEpoch?: boolean; reason?: string }>("/top10", { signal });
  if (!got.ok) return { rows: [], pauseEpoch: true, reason: "indexer top10 unreachable" };
  return got.body;
}

export function tickerStatusLabel(j: {
  ticker?: string;
  reserved?: boolean;
  available?: boolean;
  error?: string;
}): string {
  if (j.error) return j.error;
  if (j.reserved) return `${j.ticker} is reserved`;
  if (j.available === false) return `${j.ticker} is locked`;
  if (j.ticker) return `${j.ticker} available · 24h lock on success`;
  return "Ticker status offline";
}
