import assert from "node:assert/strict";
import {
  bondingPct,
  canTrade,
  earnsLabel,
  featuredMarkets,
  formatChange24h,
  formatPriceX18,
  formatUsd6Compact,
  isReadyFrozen,
  marketHref,
  primaryActionLabel,
  sparkCloses,
  stageLabel,
} from "./market-ui.ts";
import type { LaunchToken } from "./hooks.ts";

function tok(over: Partial<LaunchToken> = {}): LaunchToken {
  return {
    token: "0x1111111111111111111111111111111111110001",
    quote: "0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf",
    creator: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    mode: 0,
    poolId: "0x2ffbfbc6603aee92647bd3669a5278cbbaf7a1aaea8730beae1b36d886e2db5c",
    marketLive: true,
    fairId: 0n,
    name: "Zcash Cat",
    symbol: "ZCAT",
    decimals: 18,
    supply: 1_000_000_000n * 10n ** 18n,
    image: "",
    description: "",
    website: "",
    twitter: "",
    telegram: "",
    quoteSymbol: "ZEC",
    quoteDecimals: 8,
    rewardsMode: true,
    bonding: false,
    volume24hUsd6: (88_000n * 1_000_000n).toString(),
    fdvUsd6: (412_000n * 1_000_000n).toString(),
    priceQuoteX18: (2n * 10n ** 16n).toString(),
    ...over,
  };
}

assert.equal(marketHref(tok()), "/token/0x1111111111111111111111111111111111110001");
assert.equal(marketHref(tok({ mode: 1, marketLive: false, fairId: 7n })), "/fair/7");
assert.equal(earnsLabel(tok()), "EARNS ZEC");
assert.equal(earnsLabel(tok({ rewardsMode: false })), "BUY+BURN");
assert.equal(stageLabel(tok()), "Instant · v4");
assert.equal(stageLabel(tok({ marketLive: false, bonding: true, bondingBps: 4120 })), "41% bonded");
assert.equal(stageLabel(tok({ marketLive: false, bonding: true, ready: true, bondingBps: 10000 })), "Frozen · ready");
assert.equal(bondingPct({ bondingBps: 1640 }), 16.4);
assert.equal(isReadyFrozen({ ready: true, marketLive: false }), true);
assert.equal(canTrade({ ready: true, marketLive: false, bonding: true }), false);
assert.equal(canTrade({ ready: false, marketLive: false, bonding: true }), true);
assert.equal(canTrade({ ready: false, marketLive: true, bonding: false }), true);
assert.equal(formatUsd6Compact((412_000n * 1_000_000n).toString()), "$412.0k");
assert.equal(formatUsd6Compact("0"), "—");
assert.equal(formatChange24h("1240"), "+12.40%");
assert.equal(formatChange24h("-320"), "-3.20%");
assert.equal(formatChange24h(""), "—");
assert.equal(formatPriceX18((2n * 10n ** 16n).toString()), "0.02");
assert.equal(primaryActionLabel(tok({ mode: 1, marketLive: false })), "Auction");
assert.equal(primaryActionLabel(tok({ ready: true, marketLive: false })), "Graduate");

const board = [
  tok({ token: "0x1", symbol: "A", volume24hUsd6: "100", marketLive: true }),
  tok({
    token: "0x2",
    symbol: "B",
    marketLive: false,
    bonding: true,
    bondingBps: 9000,
    volume24hUsd6: "10",
    quoteSymbol: "USDC",
  }),
  tok({ token: "0x3", symbol: "C", mode: 1, marketLive: false, fairId: 1n, rewardsMode: true, volume24hUsd6: "1" }),
  tok({ token: "0x4", symbol: "D", rewardsMode: false, quoteSymbol: "ZCAT", volume24hUsd6: "5" }),
];
assert.equal(featuredMarkets(board).bonding?.symbol, "B");
assert.equal(featuredMarkets(board).volume?.symbol, "A");
assert.deepEqual(sparkCloses([{ c: (1n * 10n ** 18n).toString(), n: 1 }, { c: "0", n: 0 }]), [1]);

console.log("market-ui ok");
