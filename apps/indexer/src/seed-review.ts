import { openStore } from "./db.ts";
import { upsertMarket, upsertToken, recordTrade } from "./ingest.ts";

const ZCAT = "0x1111111111111111111111111111111111110001";
const GIGA = "0x1111111111111111111111111111111111110002";
const ZEC = "0x99bba657f2bbc93c02d617f8ba121cb8fc104acf";
const USDC = "0x4826533b4897376654bb4d4ad88b7fafd0c98528";
const now = Math.floor(Date.now() / 1000);

const store = await openStore();
await upsertToken(store, { address: ZCAT, symbol: "ZCAT", name: "Zcash Cat", quote: ZEC, rewardsMode: true, supply: (10n ** 27n).toString(), ts: now });
await upsertMarket(store, { token: ZCAT, quote: ZEC, stage: "v4", marketLive: true, image: "/icons/zec.svg", description: "Official ZEC-quoted Instant market.", ts: now });
await upsertToken(store, { address: GIGA, symbol: "GIGA", name: "Giga", quote: USDC, rewardsMode: true, supply: (10n ** 27n).toString(), ts: now });
await upsertMarket(store, { token: GIGA, quote: USDC, stage: "v4", marketLive: true, image: "/icons/usdc.svg", ts: now });
await store.run(
  `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
   VALUES(?,?,?,?,4,1,1,0,0,'',0) ON CONFLICT(token) DO UPDATE SET enabled=1`,
  USDC, "USDC", "USD Coin", 6,
);
await store.run(
  `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
   VALUES(?,?,?,?,0,1,0,1,0,'',0) ON CONFLICT(token) DO UPDATE SET enabled=1`,
  ZEC, "ZEC", "Mock ZEC", 8,
);
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
