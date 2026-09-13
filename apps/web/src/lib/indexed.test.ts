import { readFileSync } from "node:fs";
import {
  marketRowToLaunch,
  marketsQueryPath,
  quoteAssetRowToQuote,
  tickerStatusLabel,
} from "./indexed.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const q = quoteAssetRowToQuote({
    token: "0xabc",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    category: 4,
    enabled: 1,
    usd_peg_one: 1,
  });
  assert(q.symbol === "USDC" && q.usdPegOne === true && q.categoryLabel === "Stablecoins", "quote row");
  assert(q.enabled && q.exists, "enabled exists");
}

{
  const t = marketRowToLaunch({
    token: "0x0000000000000000000000000000000000000001",
    quote: "0xusdc",
    creator: "0xcr",
    fair_id: "2",
    market_live: 0,
    stage: "bonding",
    bonding_bps: 2500,
    real_quote: "10",
    grad_target: "20",
    symbol: "CAT",
    name: "Cat",
    ticker: "CAT",
    decimals: 18,
    current_supply: "1000",
    supply: "2000",
    quote_symbol: "USDC",
    quote_decimals: 6,
    lifetime_rewards: "5",
    rewards_mode: 1,
    price_quote_x18: "1",
    fdv_usd6: "2",
    volume_24h_usd6: "3",
  });
  assert(t.mode === 1 && t.fairId === 2n, "fair id implies mode");
  assert(t.bonding && t.ticker === "CAT", "bonding + ticker");
  assert(t.supply === 1000n && t.currentSupply === 1000n, "current_supply preferred");
  assert(t.quoteSymbol === "USDC" && t.lifetimeRewards === 5n, "quote + rewards");
}

assert(marketsQueryPath({ q: "cat", stage: "bonding", limit: 20 }) === "/markets?q=cat&stage=bonding&limit=20", "search path");
assert(marketsQueryPath({ stage: "all" }) === "/markets?limit=80", "all is not a stage filter");
assert(tickerStatusLabel({ ticker: "CAT", available: true }) === "CAT available · 24h lock on success", "available");
assert(tickerStatusLabel({ ticker: "CORE", reserved: true }) === "CORE is reserved", "reserved");
assert(tickerStatusLabel({ ticker: "CAT", available: false }) === "CAT is locked", "locked");
assert(tickerStatusLabel({ error: "bad ticker" }) === "bad ticker", "error");

{
  const ticket = readFileSync(new URL("../components/trade-panel.tsx", import.meta.url), "utf8");
  assert(ticket.includes("QUOTE_TTL_MS = 30_000"), "live quote TTL stays 30s");
  assert(!ticket.includes("useQuery"), "quote tickets stay in component state, not TanStack cache");
  const hooks = readFileSync(new URL("./hooks.ts", import.meta.url), "utf8");
  const indexed = readFileSync(new URL("./indexed.ts", import.meta.url), "utf8");
  assert(hooks.includes("loadQuoteAssets"), "launch quotes prefer indexed API");
  assert(indexed.includes("/quote-assets"), "quote-assets path stays on the indexer");
  assert(!hooks.includes("allTokensLength"), "hooks no longer walk Factory allTokens");
}

console.log("indexed mapping tests ok");
