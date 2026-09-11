import type { LaunchToken } from "@/lib/hooks";

export const REVIEW_FIXTURES = process.env.NEXT_PUBLIC_REVIEW_FIXTURES === "1";

const ZCAT = "0x1111111111111111111111111111111111110001" as `0x${string}`;
const GIGA = "0x1111111111111111111111111111111111110002" as `0x${string}`;
const FCAT = "0x1111111111111111111111111111111111110003" as `0x${string}`;
const USDC = "0x4826533B4897376654Bb4d4AD88B7faFD0C98528" as `0x${string}`;
const ZEC = "0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf" as `0x${string}`;

export const FIXTURE_TOKENS: LaunchToken[] = [
  {
    token: ZCAT,
    quote: ZEC,
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
    description: "Official ZEC-quoted Instant market. Holders earn ZEC from official volume.",
    website: "https://reactor.local",
    twitter: "",
    telegram: "",
    quoteSymbol: "ZEC",
    quoteDecimals: 8,
    lifetimeRewards: 115_646_517_17n,
  },
  {
    token: GIGA,
    quote: USDC,
    creator: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    mode: 0,
    poolId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    marketLive: true,
    fairId: 0n,
    name: "Giga",
    symbol: "GIGA",
    decimals: 18,
    supply: 1_000_000_000n * 10n ** 18n,
    image: "",
    description: "USDC Instant. Starting FDV $25k — not a Top-10 rank input.",
    website: "",
    twitter: "",
    telegram: "",
    quoteSymbol: "USDC",
    quoteDecimals: 6,
    lifetimeRewards: 200_000_000n,
  },
  {
    token: FCAT,
    quote: ZEC,
    creator: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    mode: 1,
    poolId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    marketLive: false,
    fairId: 1n,
    name: "Fair Cat",
    symbol: "FCAT",
    decimals: 18,
    supply: 1_000_000_000n * 10n ** 18n,
    image: "",
    description: "Batch Fair Launch — pro-rata timed sale, not Uniswap CCA. Auction open.",
    website: "",
    twitter: "",
    telegram: "",
    quoteSymbol: "ZEC",
    quoteDecimals: 8,
    lifetimeRewards: 0n,
  },
];

export const FIXTURE_FAIR = {
  token: FCAT,
  quote: ZEC,
  creator: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as `0x${string}`,
  startTime: BigInt(Math.floor(Date.now() / 1000) - 600),
  endTime: BigInt(Math.floor(Date.now() / 1000) + 2100),
  auctionBps: 5000,
  minRaise: 0n,
  totalBids: 3_000n * 10n ** 8n,
  auctionTokens: 500_000_000n * 10n ** 18n,
  lpTokens: 500_000_000n * 10n ** 18n,
  finalized: false,
  migrated: false,
  poolId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`,
};

export const FIXTURE_RANKS = [
  { rank: 1, symbol: "ZCAT", token: ZCAT, mcap: "$412k", weight: "31%", quote: "ZEC" },
  { rank: 2, symbol: "GIGA", token: GIGA, mcap: "$381k", weight: "28%", quote: "USDC" },
  { rank: 3, symbol: "NEON", token: "0x1111111111111111111111111111111111110004", mcap: "$340k", weight: "25%", quote: "USDC" },
  { rank: 4, symbol: "VOLT", token: "0x1111111111111111111111111111111111110005", mcap: "$210k", weight: "16%", quote: "BTC" },
];
