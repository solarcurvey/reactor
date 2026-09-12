import { formatUnitsSafe } from "./utils.ts";
import {
  buildQuoteDenomCatalog,
  feeLegQuoteToken,
  formatOfficialFeeDisclosure,
  type TicketFeeLeg,
} from "./fee-legs.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ZEC = "0x0000000000000000000000000000000000000002";
const ZCAT = "0x0000000000000000000000000000000000000003";
const CAT = "0x0000000000000000000000000000000000000004";

const nestedBuyLegs: TicketFeeLeg[] = [
  {
    reactorOfficial: true,
    protocolFeeBps: 350,
    venue: "official-v4",
    tokenIn: ZEC,
    tokenOut: ZCAT,
    // 2/1/0.5 of 750_000 ZEC (8 dec). Holders raw 1.5e12 → "15000" ZEC, or "0.000001" if mis-scaled as 18-dec.
    notionalQuote: "75000000000000",
    holders: "1500000000000",
    flywheel: "750000000000",
    core: "375000000000",
  },
  {
    reactorOfficial: true,
    protocolFeeBps: 350,
    venue: "official-v4",
    tokenIn: ZCAT,
    tokenOut: CAT,
    notionalQuote: "40000000000000000000",
    holders: "800000000000000000",
    flywheel: "400000000000000000",
    core: "200000000000000000",
  },
];

const catalog = buildQuoteDenomCatalog({
  extras: [
    { token: ZEC, symbol: "ZEC", decimals: 8 },
    { token: ZCAT, symbol: "ZCAT", decimals: 18 },
  ],
  terminal: { token: ZCAT, symbol: "ZCAT", decimals: 18 },
});

{
  assert(catalog.get(ZEC.toLowerCase())?.decimals === 8, "ZEC 8 dec in catalog");
  assert(catalog.get(ZCAT.toLowerCase())?.decimals === 18, "ZCAT 18 dec in catalog");
}

{
  const zecQuote = feeLegQuoteToken(nestedBuyLegs[0]!, new Set(catalog.keys()), "buy");
  const zcatQuote = feeLegQuoteToken(nestedBuyLegs[1]!, new Set(catalog.keys()), "buy");
  assert(zecQuote === ZEC.toLowerCase(), `ZEC→ZCAT quote is ZEC, got ${zecQuote}`);
  assert(zcatQuote === ZCAT.toLowerCase(), `ZCAT→CAT quote is ZCAT, got ${zcatQuote}`);
}

{
  const view = formatOfficialFeeDisclosure(nestedBuyLegs, catalog, {
    side: "buy",
    reactorFeeCount: 2,
    aggregateImpactBps: 688,
  });
  assert(view.officialCount === 2, `officialCount ${view.officialCount}`);
  assert(view.heterogeneous === true, "two quote tokens must be heterogeneous");
  assert(view.combined === null, "must not emit a combined split across ZEC and ZCAT");
  assert(view.legs.length === 2, `legs ${view.legs.length}`);

  const zecLeg = view.legs[0]!;
  const zcatLeg = view.legs[1]!;
  assert(zecLeg.quoteSymbol === "ZEC" && zecLeg.quoteDecimals === 8, "first leg stays ZEC-8");
  assert(zcatLeg.quoteSymbol === "ZCAT" && zcatLeg.quoteDecimals === 18, "second leg stays ZCAT-18");
  assert(zecLeg.holdersText === "15000", `ZEC holders ${zecLeg.holdersText}`);
  assert(zcatLeg.holdersText === "0.8", `ZCAT holders ${zcatLeg.holdersText}`);

  const joined = [view.headline, ...view.bodyLines].join("\n");
  assert(joined.includes("ZEC") && joined.includes("ZCAT"), "both denominations in copy");
  assert(joined.includes("15000") && joined.includes("0.8"), "per-leg formatted amounts");
  assert(joined.includes("6.88%"), "compound bps only for the aggregate");
  assert(joined.includes("not summed"), "headline refuses a cross-denom sum");

  // Davis bug: sum raw holders / flywheel / core and format with the terminal (ZCAT-18) decimals.
  const buggyHolders = BigInt(nestedBuyLegs[0]!.holders!) + BigInt(nestedBuyLegs[1]!.holders!);
  const wrongZecAsZcat = formatUnitsSafe(BigInt(nestedBuyLegs[0]!.holders!), 18, 6);
  const combinedAsZcat = formatUnitsSafe(buggyHolders, 18, 6);
  assert(wrongZecAsZcat === "0.000001", `sanity: ZEC raw with 18 dec is ${wrongZecAsZcat}`);
  assert(combinedAsZcat === "0.800001", `sanity: summed raw as ZCAT-18 is ${combinedAsZcat}`);
  assert(!joined.includes(wrongZecAsZcat), "must not format ZEC raw with ZCAT decimals");
  assert(!joined.includes(combinedAsZcat), "must not show one combined raw holders amount in ZCAT");
  assert(
    view.legs.every((l) => l.holders !== buggyHolders),
    "no formatted leg uses the summed raw holders",
  );
}

{
  const sameQuote: TicketFeeLeg[] = [
    { ...nestedBuyLegs[1]!, notionalQuote: "10000000000000000000", holders: "200000000000000000", flywheel: "100000000000000000", core: "50000000000000000" },
    { ...nestedBuyLegs[1]!, notionalQuote: "20000000000000000000", holders: "400000000000000000", flywheel: "200000000000000000", core: "100000000000000000" },
  ];
  const view = formatOfficialFeeDisclosure(sameQuote, catalog, { side: "buy", reactorFeeCount: 2 });
  assert(view.heterogeneous === false, "same quote token may combine");
  assert(view.combined !== null && view.combined.quoteSymbol === "ZCAT", "combined stays ZCAT");
  assert(view.combined!.holders === 600000000000000000n, "same-denom holders sum");
  assert(view.legs[0]!.quoteDecimals === 18 && view.legs[1]!.quoteDecimals === 18, "both legs ZCAT-18");
}

console.log("fee-leg UI denomination tests ok");
