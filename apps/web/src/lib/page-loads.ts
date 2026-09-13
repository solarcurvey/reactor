import { BOARD_PAGE_SIZE } from "./page-budget";
import type { BatchClient } from "./rpc-batch";
import {
  loadLaunchList,
  loadQuoteAssets,
  loadReactorEvents,
  loadTickerStatus,
  loadTokenPage,
  loadTop10,
  type LaunchToken,
} from "./indexed";
import {
  readCoreStatsBatched,
  readPendingRewardsPage,
  readTicketWallet,
  readVestingBatched,
  readWalletSnapshot,
} from "./wallet-reads";

export async function loadHomePage(signal?: AbortSignal) {
  const items = await loadLaunchList({ limit: BOARD_PAGE_SIZE }, signal);
  return { items };
}

export async function loadSearchPage(opts: { q?: string; stage?: string }, signal?: AbortSignal) {
  return loadLaunchList({ q: opts.q, stage: opts.stage, limit: BOARD_PAGE_SIZE }, signal);
}

export async function loadTokenTerminal(
  token: string,
  opts: {
    interval?: string;
    signal?: AbortSignal;
    client?: BatchClient;
    core?: { address: `0x${string}`; abi: unknown[] };
    buyback?: { address: `0x${string}`; abi: unknown[] };
    usdc?: `0x${string}`;
    wallet?: {
      owner: `0x${string}`;
      quote: `0x${string}`;
      spender: `0x${string}`;
      payAsset: `0x${string}`;
    };
  } = {},
) {
  const page = await loadTokenPage(token, opts.interval ?? "5m", opts.signal);
  const core =
    opts.client && opts.core && opts.buyback && opts.usdc
      ? await readCoreStatsBatched(opts.client, opts.core, opts.buyback, opts.usdc, opts.signal)
      : undefined;
  const wallet =
    opts.client && opts.wallet
      ? await readTicketWallet(opts.client, { ...opts.wallet, token: token as `0x${string}`, signal: opts.signal })
      : undefined;
  return { ...page, core, wallet };
}

export async function loadLaunchPage(ticker: string, signal?: AbortSignal) {
  const [quotes, tickerStatus] = await Promise.all([loadQuoteAssets(signal), loadTickerStatus(ticker, signal)]);
  return { quotes, tickerStatus };
}

export async function loadRewardsPage(
  opts: { account?: `0x${string}`; client?: BatchClient; signal?: AbortSignal } = {},
) {
  const items = await loadLaunchList({ limit: BOARD_PAGE_SIZE }, opts.signal);
  const pending =
    opts.account && opts.client
      ? await readPendingRewardsPage(
          opts.client,
          items.map((t) => t.token),
          opts.account,
          opts.signal,
        )
      : items.map(() => 0n);
  return items.map((t, i) => ({ token: t, pending: pending[i] ?? 0n }));
}

export async function loadReactorPage(signal?: AbortSignal) {
  const [top10, events] = await Promise.all([loadTop10(signal), loadReactorEvents(signal)]);
  return { top10, events };
}

export async function loadCorePage(
  client: BatchClient,
  opts: {
    core: { address: `0x${string}`; abi: unknown[] };
    buyback: { address: `0x${string}`; abi: unknown[] };
    usdc: `0x${string}`;
    vesting?: { address: `0x${string}`; abi: unknown[] };
    signal?: AbortSignal;
  },
) {
  const stats = await readCoreStatsBatched(client, opts.core, opts.buyback, opts.usdc, opts.signal);
  const vesting = opts.vesting
    ? await readVestingBatched(client, opts.vesting.address, opts.vesting.abi, opts.signal)
    : undefined;
  return { stats, vesting };
}

export async function loadQuoteEcosystem(symbol: string, signal?: AbortSignal) {
  const quotes = await loadQuoteAssets(signal);
  const quote = quotes.find((q) => q.symbol.toUpperCase() === symbol.toUpperCase());
  const items = quote
    ? await loadLaunchList({ quote: quote.token, limit: BOARD_PAGE_SIZE }, signal)
    : ([] as LaunchToken[]);
  return { quotes, quote, items };
}

export async function loadWalletPage(
  client: BatchClient,
  opts: { owner: `0x${string}`; usdc: `0x${string}`; core: `0x${string}`; spender: `0x${string}`; signal?: AbortSignal },
) {
  return readWalletSnapshot(client, opts);
}
