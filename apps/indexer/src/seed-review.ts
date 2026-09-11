import { openStore } from "./db.ts";
import { upsertMarket, upsertToken, recordTrade } from "./ingest.ts";

const ZCAT = "0x1111111111111111111111111111111111110001";
const GIGA = "0x1111111111111111111111111111111111110002";
const FCAT = "0x1111111111111111111111111111111111110003";
const CAT = "0x1111111111111111111111111111111111110006";
const BOND = "0x1111111111111111111111111111111111110007";
const ZEC = "0x99bba657f2bbc93c02d617f8ba121cb8fc104acf";
const USDC = "0x4826533b4897376654bb4d4ad88b7fafd0c98528";
const now = Math.floor(Date.now() / 1000);

const store = await openStore();
await store.run(
  `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
   VALUES(?,?,?,?,0,1,0,1,0,'',0) ON CONFLICT(token) DO UPDATE SET symbol=excluded.symbol, decimals=excluded.decimals, enabled=1`,
  ZEC.toLowerCase(), "ZEC", "Mock ZEC", 8,
);
await store.run(
  `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
   VALUES(?,?,?,?,4,1,1,0,0,'',0) ON CONFLICT(token) DO UPDATE SET symbol=excluded.symbol, decimals=excluded.decimals, enabled=1`,
  USDC.toLowerCase(), "USDC", "USD Coin", 6,
);
await store.run(
  `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
   VALUES(?,?,?,?,3,1,0,0,1,?,0) ON CONFLICT(token) DO UPDATE SET symbol=excluded.symbol, decimals=excluded.decimals, enabled=1, parent_quote=excluded.parent_quote`,
  ZCAT.toLowerCase(), "ZCAT", "Zcash Cat", 18, ZEC.toLowerCase(),
);
await upsertToken(store, { address: ZCAT, symbol: "ZCAT", name: "Zcash Cat", quote: ZEC, rewardsMode: true, supply: (10n ** 27n).toString(), ts: now });
await upsertMarket(store, { token: ZCAT, quote: ZEC, stage: "v4", marketLive: true, image: "/icons/zec.svg", description: "Official ZEC-quoted Instant market.", ts: now });
await upsertToken(store, { address: GIGA, symbol: "GIGA", name: "Giga", quote: USDC, rewardsMode: true, supply: (10n ** 27n).toString(), ts: now });
await upsertMarket(store, { token: GIGA, quote: USDC, stage: "v4", marketLive: true, image: "/icons/usdc.svg", ts: now });
await upsertToken(store, { address: FCAT, symbol: "FCAT", name: "Fair Cat", quote: ZEC, mode: 1, ts: now });
await upsertMarket(store, { token: FCAT, quote: ZEC, stage: "fair", fairId: "1", image: "/icons/zec.svg", ts: now });
await upsertToken(store, { address: CAT, symbol: "CAT", name: "Cat", quote: ZCAT, rewardsMode: false, ts: now });
await upsertMarket(store, { token: CAT, quote: ZCAT, stage: "bonding", bondingBps: 4120, image: "/icons/usdc.svg", ts: now });
await upsertToken(store, { address: BOND, symbol: "BOND", name: "Bond", quote: USDC, ts: now });
await upsertMarket(store, { token: BOND, quote: USDC, stage: "bonding", bondingBps: 6100, image: "/icons/usdc.svg", ts: now });
const marks: [string, string, string, string, string][] = [
  [ZCAT, (2n * 10n ** 16n).toString(), (412_000n * 1_000_000n).toString(), (88_000n * 1_000_000n).toString(), "11564651717"],
  [GIGA, (381n * 10n ** 15n).toString(), (381_000n * 1_000_000n).toString(), (42_000n * 1_000_000n).toString(), "200000000"],
  [FCAT, (8n * 10n ** 14n).toString(), (41_000n * 1_000_000n).toString(), (3_200n * 1_000_000n).toString(), "0"],
  [CAT, (5n * 10n ** 16n).toString(), (22_000n * 1_000_000n).toString(), (1_100n * 1_000_000n).toString(), "0"],
  [BOND, (12n * 10n ** 13n).toString(), (12_000n * 1_000_000n).toString(), (6_400n * 1_000_000n).toString(), "40000000"],
];
for (const [token, px, fdv, vol, rewards] of marks) {
  await store.run(
    "UPDATE markets SET price_quote_x18=?, fdv_usd6=?, volume_24h_usd6=?, lifetime_rewards=? WHERE token=?",
    px,
    fdv,
    vol,
    rewards,
    token.toLowerCase(),
  );
}
for (let i = 0; i < 8; i++) {
  await recordTrade(store, undefined, {
    block: 100 + i,
    tx: `0xseed${i}`,
    logIndex: i,
    token: ZCAT,
    quote: ZEC,
    side: "buy",
    source: i > 4 ? "v4" : "curve",
    amountIn: "100000000",
    amountOut: "5000000000000000000",
    notionalQuote: "100000000",
    priceQuoteX18: (20n * 10n ** 15n + BigInt(i) * 10n ** 14n).toString(),
    ts: now - 3600 + i * 300,
  });
}
console.log("seeded review markets + continuous curve→v4 candles");
await store.close();
