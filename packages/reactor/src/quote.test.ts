import {
  REACTOR_FEE_BPS,
  buildFeeDisclosure,
  compoundProtocolImpactBps,
  hopQuoteNotional,
  makeFeeLeg,
  splitQuoteFee,
} from "./quote.ts";
import {
  VENUE,
  displayVenueKind,
  isHooklessVenue,
  isOfficialReactorVenue,
  planCandidates,
  planRoute,
} from "./routes.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const USDC = "0x0000000000000000000000000000000000000001";
const ZEC = "0x0000000000000000000000000000000000000002";
const ZCAT = "0x0000000000000000000000000000000000000003";
const CAT = "0x0000000000000000000000000000000000000004";
const quotes = new Set([USDC.toLowerCase(), ZEC.toLowerCase(), ZCAT.toLowerCase()]);

{
  assert(compoundProtocolImpactBps([350, 350]) === 688, `two 3.5% → 6.88% got ${compoundProtocolImpactBps([350, 350])}`);
  assert(compoundProtocolImpactBps([350]) === 350, "single 3.5%");
  assert(compoundProtocolImpactBps([]) === 0, "empty");
  assert(compoundProtocolImpactBps([0, 350]) === 350, "zero legs ignored");
}

{
  const buy = hopQuoteNotional({ tokenIn: ZEC, tokenOut: ZCAT, amountIn: "1000", amountOut: "900" }, quotes, "BUY");
  const sell = hopQuoteNotional({ tokenIn: ZCAT, tokenOut: ZEC, amountIn: "900", amountOut: "1000" }, quotes, "SELL");
  assert(buy === 1000n, `buy notional ${buy}`);
  assert(sell === 1000n, `sell notional ${sell}`);
}

{
  const hookless = makeFeeLeg(VENUE.EXTERNAL_V4_HOOKLESS, USDC, ZEC, 1_000_000n, false, false, VENUE.EXTERNAL_V4_HOOKLESS);
  assert(!hookless.reactorOfficial && hookless.protocolFeeBps === 0, "hookless not a REACTOR fee");
  const official = makeFeeLeg("official-v4", ZEC, ZCAT, 10_000n, true, false, VENUE.OFFICIAL_REACTOR_V4);
  const s = splitQuoteFee(10_000n);
  assert(official.reactorOfficial && official.protocolFeeBps === REACTOR_FEE_BPS, "official 3.5%");
  assert(official.holders === s.holders.toString() && official.flywheel === s.flywheel.toString(), "2/1/0.5");
  const exempt = makeFeeLeg("official-v4", ZEC, USDC, 10_000n, true, true, VENUE.OFFICIAL_REACTOR_V4);
  assert(exempt.reactorOfficial && exempt.feeExempt && exempt.protocolFeeBps === 0, "exempt official is 0 bps");
}

{
  // USDC → ZEC (hookless) → ZCAT (official) → CAT (official). BUY.
  const d = buildFeeDisclosure(
    [
      {
        tokenIn: USDC,
        tokenOut: ZEC,
        amountIn: "1000000",
        amountOut: "50000000",
        kind: VENUE.EXTERNAL_V4_HOOKLESS,
      },
      {
        tokenIn: ZEC,
        tokenOut: ZCAT,
        amountIn: "50000000",
        amountOut: "40000000",
        kind: VENUE.OFFICIAL_REACTOR_V4,
      },
    ],
    {
      feeExempt: false,
      quoteTokens: quotes,
      side: "BUY",
      finalMarket: {
        tokenIn: ZCAT,
        tokenOut: CAT,
        amountIn: "40000000",
        amountOut: "1000000000000000000",
        kind: VENUE.OFFICIAL_REACTOR_V4,
        official: true,
        venue: "official-v4",
      },
    },
  );
  assert(d.feeLegs.length === 2, `buy feeLegs ${d.feeLegs.length}`);
  assert(d.reactorFeeCount === 2, `buy reactorFeeCount ${d.reactorFeeCount}`);
  assert(d.totalProtocolFeeBps === 700, `buy sum bps ${d.totalProtocolFeeBps}`);
  assert(d.aggregateProtocolImpactBps === 688, `buy compound ${d.aggregateProtocolImpactBps}`);
  assert(
    d.feeLegs.every((f) => f.reactorOfficial && f.protocolFeeBps === 350 && !f.feeExempt),
    "both buy legs 3.5%",
  );
  assert(
    d.feeLegs[0]!.tokenIn.toLowerCase() === ZEC.toLowerCase() && d.feeLegs[0]!.tokenOut.toLowerCase() === ZCAT.toLowerCase(),
    "first official ZEC→ZCAT",
  );
  assert(
    d.feeLegs[1]!.tokenIn.toLowerCase() === ZCAT.toLowerCase() && d.feeLegs[1]!.tokenOut.toLowerCase() === CAT.toLowerCase(),
    "second official ZCAT→CAT",
  );
  assert(d.exemptOfficialLegs.length === 0, "user buy has no exempt legs");
}

{
  // CAT → ZCAT (official) → ZEC (official) → USDC (hookless). SELL.
  const d = buildFeeDisclosure(
    [
      {
        tokenIn: ZCAT,
        tokenOut: ZEC,
        amountIn: "40000000",
        amountOut: "50000000",
        kind: VENUE.OFFICIAL_REACTOR_V4,
      },
      {
        tokenIn: ZEC,
        tokenOut: USDC,
        amountIn: "50000000",
        amountOut: "960000",
        kind: VENUE.EXTERNAL_V4_HOOKLESS,
      },
    ],
    {
      feeExempt: false,
      quoteTokens: quotes,
      side: "SELL",
      finalMarket: {
        tokenIn: CAT,
        tokenOut: ZCAT,
        amountIn: "1000000000000000000",
        amountOut: "40000000",
        kind: VENUE.OFFICIAL_REACTOR_V4,
        official: true,
        venue: "official-v4",
      },
    },
  );
  assert(d.feeLegs.length === 2, `sell feeLegs ${d.feeLegs.length}`);
  assert(d.reactorFeeCount === 2 && d.totalProtocolFeeBps === 700, "sell two 3.5%");
  assert(d.aggregateProtocolImpactBps === 688, `sell compound ${d.aggregateProtocolImpactBps}`);
  assert(
    d.feeLegs.some((f) => f.tokenIn.toLowerCase() === CAT.toLowerCase() && f.tokenOut.toLowerCase() === ZCAT.toLowerCase()),
    "sell includes CAT→ZCAT",
  );
  assert(
    d.feeLegs.some((f) => f.tokenIn.toLowerCase() === ZCAT.toLowerCase() && f.tokenOut.toLowerCase() === ZEC.toLowerCase()),
    "sell includes ZCAT→ZEC",
  );
  assert(
    !d.feeLegs.some((f) => f.tokenOut.toLowerCase() === USDC.toLowerCase() && f.reactorOfficial),
    "hookless ZEC→USDC is not a REACTOR fee",
  );
}

{
  const d = buildFeeDisclosure(
    [
      {
        tokenIn: ZCAT,
        tokenOut: ZEC,
        amountIn: "100",
        amountOut: "90",
        kind: "protocol",
      },
      {
        tokenIn: ZEC,
        tokenOut: USDC,
        amountIn: "90",
        amountOut: "80",
        kind: "hookless",
      },
    ],
    { feeExempt: true, quoteTokens: quotes },
  );
  assert(d.feeLegs.length === 0 && d.reactorFeeCount === 0 && d.totalProtocolFeeBps === 0, "maintenance not user fees");
  assert(d.aggregateProtocolImpactBps === 0, "maintenance compound 0");
  assert(d.exemptOfficialLegs.length === 1, `exempt official ${d.exemptOfficialLegs.length}`);
  assert(d.exemptOfficialLegs[0]!.reactorOfficial && d.exemptOfficialLegs[0]!.feeExempt, "exempt flagged");
  assert(d.exemptOfficialLegs[0]!.protocolFeeBps === 0, "exempt 0 bps");
  assert(d.exemptOfficialLegs[0]!.tokenIn.toLowerCase() === ZCAT.toLowerCase(), "exempt is official ZCAT→ZEC");
}

{
  assert(isOfficialReactorVenue("user") && isOfficialReactorVenue("protocol"), "user/protocol official");
  assert(isOfficialReactorVenue(VENUE.OFFICIAL_REACTOR_V4) && isOfficialReactorVenue(VENUE.BONDING_CURVE), "venue official");
  assert(isHooklessVenue("hookless") && isHooklessVenue(VENUE.EXTERNAL_V4_HOOKLESS), "hookless");
  assert(!isOfficialReactorVenue(VENUE.EXTERNAL_V4_HOOKLESS), "hookless not official");
  assert(displayVenueKind("user") === VENUE.OFFICIAL_REACTOR_V4, "user displays official");
  assert(displayVenueKind("hookless") === VENUE.EXTERNAL_V4_HOOKLESS, "hookless displays external");
}

{
  const edges = [
    { from: USDC, to: ZEC, adapter: "0x00000000000000000000000000000000000000aa", kind: "hookless" as const, data: "0x03" as `0x${string}`, usable: true },
    { from: ZEC, to: ZCAT, adapter: "0x00000000000000000000000000000000000000aa", kind: "user" as const, data: "0x04" as `0x${string}`, usable: true },
    { from: ZCAT, to: CAT, adapter: "0x00000000000000000000000000000000000000aa", kind: "user" as const, data: "0x05" as `0x${string}`, usable: true },
    { from: CAT, to: ZCAT, adapter: "0x00000000000000000000000000000000000000aa", kind: "user" as const, data: "0x06" as `0x${string}`, usable: true },
    { from: ZCAT, to: ZEC, adapter: "0x00000000000000000000000000000000000000aa", kind: "user" as const, data: "0x07" as `0x${string}`, usable: true },
    { from: ZEC, to: USDC, adapter: "0x00000000000000000000000000000000000000aa", kind: "hookless" as const, data: "0x08" as `0x${string}`, usable: true },
  ];
  const metas = new Map(
    [USDC, ZEC, ZCAT, CAT].map((t) => [t.toLowerCase(), { token: t, symbol: t.slice(0, 6), enabled: true }]),
  );
  const adapters = new Set(["0x00000000000000000000000000000000000000aa"]);
  const buy = planRoute(USDC, CAT, edges, metas, { protocol: false, adapters });
  assert(buy.hops.length === 3, `planner buy hops ${buy.hops.length}`);
  assert(buy.hops[0]!.kind === "hookless", "USDC→ZEC kind");
  assert(buy.hops[1]!.kind === "user" && buy.hops[2]!.kind === "user", "official kinds preserved");
  const sell = planCandidates(CAT, USDC, edges, metas, { protocol: false, adapters })[0]!;
  assert(sell.hops.every((h) => h.kind), "sell candidates keep kind");
  assert(sell.hops[0]!.kind === "user" && sell.hops[sell.hops.length - 1]!.kind === "hookless", "sell official then hookless");
}

console.log("quote fee-leg disclosure tests ok");
