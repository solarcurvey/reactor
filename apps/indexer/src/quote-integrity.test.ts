/**
 * Regression: quote-service must not mix max-finalOut preview with a
 * differently scored route. Ticket hops / path / kinds / amountOut / minOuts
 * / terminal market-leg come from the same pickBest winner.
 *
 * PreviewRoute ABI: hopOuts/kinds length === plannedHops.length + 1
 * (extra element is the official/bonding market leg).
 */
import { applySlippage } from "../../../packages/reactor/src/quote.ts";
import { RouteReject, VENUE, type Hop, type PlannedRoute } from "../../../packages/reactor/src/routes.ts";
import {
  KIND_HASH,
  assembleAtomicTicket,
  decodePreviewRoute,
  discloseSelectedRoute,
  encodePreviewRoute,
  hopsFromAtomicPreview,
  previewedRoute,
  quoteScoreOpts,
  selectAtomicQuotedRoute,
  splitPreviewRoute,
  type QuoteSide,
} from "./quote-select.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ADAPTER = "0x00000000000000000000000000000000000000aa" as const;
const USDC = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const ZEC = "0x0000000000000000000000000000000000000002" as `0x${string}`;
const ZCAT = "0x0000000000000000000000000000000000000003" as `0x${string}`;

function hop(tokenIn: `0x${string}`, tokenOut: `0x${string}`, data: `0x${string}`): Hop {
  return { adapter: ADAPTER, tokenIn, tokenOut, minOut: 0n, data };
}

/** BUY: USDC → … → market quote, then terminal official/bonding. */
const fatBuy: PlannedRoute = {
  hops: [hop(USDC, ZEC, "0x01"), hop(ZEC, ZCAT, "0x02")],
  path: [USDC, ZEC, ZCAT],
  reason: "ok fat buy",
};
const thinBuy: PlannedRoute = {
  hops: [hop(USDC, ZCAT, "0x03")],
  path: [USDC, ZCAT],
  reason: "ok thin buy",
};

/** SELL: terminal official/bonding first, then quote → … → USDC hops. */
const fatSell: PlannedRoute = {
  hops: [hop(ZCAT, ZEC, "0x11"), hop(ZEC, USDC, "0x12")],
  path: [ZCAT, ZEC, USDC],
  reason: "ok fat sell",
};
const thinSell: PlannedRoute = {
  hops: [hop(ZCAT, USDC, "0x13")],
  path: [ZCAT, USDC],
  reason: "ok thin sell",
};

/** Same error ABI + decode path `POST /quote` uses (`decodePreviewRoute`). */
function quoterPreview(amountOut: bigint, hopOuts: bigint[], kinds: readonly `0x${string}`[]) {
  const raw = encodePreviewRoute(amountOut, hopOuts, kinds);
  assert(raw.startsWith("0x"), "PreviewRoute revert payload");
  const decoded = decodePreviewRoute(raw);
  assert(decoded.amountOut === amountOut, "PreviewRoute amountOut round-trip");
  assert(decoded.hopOuts.length === hopOuts.length, "PreviewRoute hopOuts length");
  assert(decoded.hopOuts.length === kinds.length, "PreviewRoute hopOuts/kinds paired");
  return decoded;
}

// 1 planned hop → 2 PreviewRoute slots (routing + terminal).
const thinBuyPreview = quoterPreview(9_900n, [9_400n, 9_900n], [KIND_HASH.EXTERNAL_V4_HOOKLESS, KIND_HASH.OFFICIAL_REACTOR_V4]);
const fatBuyPreview = quoterPreview(
  10_000n,
  [9_800n, 9_700n, 10_000n],
  [KIND_HASH.EXTERNAL_V4_HOOKLESS, KIND_HASH.EXTERNAL_V4_HOOKLESS, KIND_HASH.OFFICIAL_REACTOR_V4],
);
const thinSellPreview = quoterPreview(9_900n, [9_350n, 9_900n], [KIND_HASH.OFFICIAL_REACTOR_V4, KIND_HASH.EXTERNAL_V4_HOOKLESS]);
const fatSellPreview = quoterPreview(
  10_000n,
  [9_600n, 9_500n, 10_000n],
  [KIND_HASH.OFFICIAL_REACTOR_V4, KIND_HASH.EXTERNAL_V4_HOOKLESS, KIND_HASH.EXTERNAL_V4_HOOKLESS],
);

assert(thinBuyPreview.hopOuts.length === thinBuy.hops.length + 1, "BUY thin is hops+1");
assert(fatBuyPreview.hopOuts.length === fatBuy.hops.length + 1, "BUY fat is hops+1");
assert(thinSellPreview.hopOuts.length === thinSell.hops.length + 1, "SELL thin is hops+1");
assert(fatSellPreview.hopOuts.length === fatSell.hops.length + 1, "SELL fat is hops+1");

function scored(planned: PlannedRoute, preview: ReturnType<typeof quoterPreview>, side: QuoteSide) {
  return previewedRoute(planned, preview, quoteScoreOpts(planned.hops.length), side);
}

const fatBuyScored = scored(fatBuy, fatBuyPreview, "BUY");
const thinBuyScored = scored(thinBuy, thinBuyPreview, "BUY");
const fatSellScored = scored(fatSell, fatSellPreview, "SELL");
const thinSellScored = scored(thinSell, thinSellPreview, "SELL");

{
  assert(fatBuyPreview.amountOut > thinBuyPreview.amountOut, "BUY fat has max finalOut");
  assert(
    thinBuyScored.score > fatBuyScored.score,
    `BUY thin wins pickBest (thin ${thinBuyScored.score} vs fat ${fatBuyScored.score})`,
  );
  assert(fatSellPreview.amountOut > thinSellPreview.amountOut, "SELL fat has max finalOut");
  assert(
    thinSellScored.score > fatSellScored.score,
    `SELL thin wins pickBest (thin ${thinSellScored.score} vs fat ${fatSellScored.score})`,
  );
}

function assertAtomicWinner(
  side: QuoteSide,
  selected: ReturnType<typeof selectAtomicQuotedRoute>,
  winnerRoute: PlannedRoute,
  winnerPreview: ReturnType<typeof quoterPreview>,
  loserPreview: ReturnType<typeof quoterPreview>,
  amountIn: bigint,
) {
  assert(selected.path.join(",") === winnerRoute.path.join(","), `${side} path is scored winner`);
  assert(selected.hops.length === winnerRoute.hops.length, `${side} hop count is winner`);
  assert(selected.preview.amountOut === winnerPreview.amountOut, `${side} whole preview from winner`);
  assert(selected.preview.hopOuts.length === winnerRoute.hops.length + 1, `${side} preview is hops+1`);
  assert(selected.preview.amountOut !== loserPreview.amountOut, `${side} must not stitch max finalOut`);

  const split = splitPreviewRoute(selected);
  const ticket = assembleAtomicTicket(selected, amountIn, 100);
  assert(ticket.path.join(",") === winnerRoute.path.join(","), `${side} ticket path`);
  assert(ticket.hops.length === winnerRoute.hops.length, `${side} ticket routing hops only`);
  assert(ticket.amountOut === winnerPreview.amountOut, `${side} ticket amountOut is final`);
  assert(ticket.minOut === applySlippage(winnerPreview.amountOut, 100), `${side} ticket minOut from final`);
  assert(ticket.terminalOut === split.terminalOut, `${side} terminal from same preview`);
  assert(ticket.terminalKind === split.terminalKind, `${side} terminal kind from same preview`);
  assert(ticket.terminalMinOut === applySlippage(split.terminalOut, 100), `${side} terminal minOut`);

  for (let i = 0; i < ticket.hops.length; i++) {
    assert(ticket.hops[i]!.amountOut === split.routingOuts[i]!.toString(), `${side} hop ${i} out`);
    assert(ticket.hops[i]!.kind === split.routingKinds[i], `${side} hop ${i} kind`);
    assert(ticket.hops[i]!.minOut === applySlippage(split.routingOuts[i]!, 100), `${side} hop ${i} minOut`);
    assert(ticket.hops[i]!.data === winnerRoute.hops[i]!.data, `${side} hop ${i} data`);
  }
  if (side === "BUY") {
    assert(split.terminalOut === winnerPreview.hopOuts[winnerRoute.hops.length], `${side} terminal is last slot`);
    assert(split.routingOuts[0] === winnerPreview.hopOuts[0], `${side} first routing is slot 0`);
    assert(ticket.hops[0]!.amountIn === amountIn.toString(), `${side} first hop in is amountIn`);
    assert(ticket.terminalKind === VENUE.OFFICIAL_REACTOR_V4, `${side} terminal official`);
  } else {
    assert(split.terminalOut === winnerPreview.hopOuts[0], `${side} terminal is first slot`);
    assert(split.routingOuts[0] === winnerPreview.hopOuts[1], `${side} first routing is slot 1`);
    assert(ticket.hops[0]!.amountIn === split.terminalOut.toString(), `${side} first hop in is terminal quote`);
    assert(ticket.terminalKind === VENUE.OFFICIAL_REACTOR_V4, `${side} terminal official`);
  }
}

{
  const selected = selectAtomicQuotedRoute([fatBuyScored, thinBuyScored]);
  assertAtomicWinner("BUY", selected, thinBuy, thinBuyPreview, fatBuyPreview, 1_000_000n);
  const ticket = assembleAtomicTicket(selected, 1_000_000n, 100);
  assert(ticket.hops[0]!.amountOut === "9400", "BUY thin routing out");
  assert(ticket.hops[0]!.kind === VENUE.EXTERNAL_V4_HOOKLESS, "BUY thin routing kind");
  assert(ticket.terminalOut === 9_900n, "BUY thin terminal tokens");
  assert(ticket.amountOut === 9_900n, "BUY amountOut is final tokens");
}

{
  const selected = selectAtomicQuotedRoute([fatSellScored, thinSellScored]);
  assertAtomicWinner("SELL", selected, thinSell, thinSellPreview, fatSellPreview, 5_000n);
  const ticket = assembleAtomicTicket(selected, 5_000n, 100);
  assert(ticket.hops[0]!.amountOut === "9900", "SELL thin routing USDC out");
  assert(ticket.hops[0]!.kind === VENUE.EXTERNAL_V4_HOOKLESS, "SELL thin routing kind");
  assert(ticket.terminalOut === 9_350n, "SELL thin terminal quote");
  assert(ticket.amountOut === 9_900n, "SELL amountOut is final USDC");
}

{
  const fatWins = previewedRoute(fatBuy, fatBuyPreview, { impactBps: 0, gasEstimate: 0, reliabilityBps: 50_000 }, "BUY");
  const selected = selectAtomicQuotedRoute([fatWins, thinBuyScored]);
  assertAtomicWinner("BUY", selected, fatBuy, fatBuyPreview, thinBuyPreview, 1_000_000n);
  const ticket = assembleAtomicTicket(selected, 1_000_000n, 100);
  assert(ticket.hops[0]!.amountOut === "9800" && ticket.hops[1]!.amountOut === "9700", "BUY fat routing outs");
  assert(ticket.hops[1]!.amountIn === "9800", "BUY fat hop1 in is previous routing out");
  assert(ticket.terminalOut === 10_000n, "BUY fat terminal");
}

{
  const fatWins = previewedRoute(fatSell, fatSellPreview, { impactBps: 0, gasEstimate: 0, reliabilityBps: 50_000 }, "SELL");
  const selected = selectAtomicQuotedRoute([fatWins, thinSellScored]);
  assertAtomicWinner("SELL", selected, fatSell, fatSellPreview, thinSellPreview, 5_000n);
  const ticket = assembleAtomicTicket(selected, 5_000n, 100);
  assert(ticket.hops[0]!.amountOut === "9500" && ticket.hops[1]!.amountOut === "10000", "SELL fat routing outs");
  assert(ticket.hops[1]!.amountIn === "9500", "SELL fat hop1 in is previous routing out");
  assert(ticket.terminalOut === 9_600n, "SELL fat terminal quote");
}

{
  // Real 1-hop nested BUY returns 2 slots — must not RouteReject.
  const oneHop = selectAtomicQuotedRoute([thinBuyScored]);
  assert(oneHop.preview.hopOuts.length === 2, "1-hop BUY PreviewRoute has 2 slots");
  const split = splitPreviewRoute(oneHop);
  assert(split.routingOuts.length === 1 && split.terminalOut === 9_900n, "1-hop BUY splits routing vs terminal");
}

{
  let threw = false;
  try {
    // Hop-count-sized arrays are the old synthetic (wrong) shape.
    selectAtomicQuotedRoute([
      previewedRoute(thinBuy, { amountOut: 9_900n, hopOuts: [9_900n], kinds: [VENUE.OFFICIAL_REACTOR_V4] }, quoteScoreOpts(1), "BUY"),
    ]);
  } catch (e) {
    threw = e instanceof RouteReject && String(e.message).includes("plannedHops.length + 1");
  }
  assert(threw, "reject hop-count-sized PreviewRoute (missing terminal slot)");
}

{
  let threw = false;
  try {
    selectAtomicQuotedRoute([
      previewedRoute(
        thinBuy,
        { amountOut: 10_000n, hopOuts: [1n, 2n, 3n], kinds: [VENUE.OFFICIAL_REACTOR_V4, VENUE.EXTERNAL_V4_HOOKLESS, VENUE.BONDING_CURVE] },
        quoteScoreOpts(1),
        "BUY",
      ),
    ]);
  } catch (e) {
    threw = e instanceof RouteReject && String(e.message).includes("plannedHops.length + 1");
  }
  assert(threw, "reject PreviewRoute longer than hops+1");
}

{
  const fallback = previewedRoute(thinBuy, { amountOut: 9_900n, hopOuts: [], kinds: [] }, quoteScoreOpts(1), "BUY");
  const selected = selectAtomicQuotedRoute([fallback]);
  const hops = hopsFromAtomicPreview(selected, 100n);
  assert(hops.length === 1 && hops[0]!.amountOut === "0", "empty hopOuts stay 0 (executor fallback)");
  assert(hops[0]!.kind === VENUE.EXTERNAL_V4_HOOKLESS, "empty kinds default hookless");
}

{
  // Issue #5 / #3: max raw output ≠ scored winner. feeLegs/kinds/notionals
  // must come from the pickBest winner, never the independently tracked max-out preview.
  const CAT = "0x0000000000000000000000000000000000000004" as `0x${string}`;
  const quotes = new Set([USDC.toLowerCase(), ZEC.toLowerCase(), ZCAT.toLowerCase()]);
  const amountIn = 1_000_000n;

  const fatOfficial: PlannedRoute = {
    hops: [hop(USDC, ZEC, "0x21"), hop(ZEC, ZCAT, "0x22")],
    path: [USDC, ZEC, ZCAT],
    reason: "fat official intermediate",
  };
  const thinDirect: PlannedRoute = {
    hops: [hop(USDC, ZCAT, "0x23")],
    path: [USDC, ZCAT],
    reason: "thin scored winner",
  };
  const fatOfficialPreview = quoterPreview(
    10_000n,
    [9_800n, 9_700n, 10_000n],
    [KIND_HASH.EXTERNAL_V4_HOOKLESS, KIND_HASH.OFFICIAL_REACTOR_V4, KIND_HASH.OFFICIAL_REACTOR_V4],
  );
  const thinDirectPreview = quoterPreview(
    9_900n,
    [9_400n, 9_900n],
    [KIND_HASH.EXTERNAL_V4_HOOKLESS, KIND_HASH.OFFICIAL_REACTOR_V4],
  );
  const fatScored = scored(fatOfficial, fatOfficialPreview, "BUY");
  const thinScored = scored(thinDirect, thinDirectPreview, "BUY");
  assert(fatOfficialPreview.amountOut > thinDirectPreview.amountOut, "fat has max raw output");
  assert(thinScored.score > fatScored.score, "thin still wins pickBest");

  const selected = selectAtomicQuotedRoute([fatScored, thinScored]);
  assert(selected.path.join(",") === thinDirect.path.join(","), "winner path is thin");
  const hops = hopsFromAtomicPreview(selected, amountIn);
  const winnerFees = discloseSelectedRoute(selected, hops, {
    feeExempt: false,
    quoteTokens: quotes,
    market: { token: CAT, quote: ZCAT },
    amountIn,
    bonding: false,
  });
  const loserFees = discloseSelectedRoute(fatScored, hopsFromAtomicPreview(fatScored, amountIn), {
    feeExempt: false,
    quoteTokens: quotes,
    market: { token: CAT, quote: ZCAT },
    amountIn,
    bonding: false,
  });

  assert(winnerFees.feeLegs.length === 1, `winner feeLegs ${winnerFees.feeLegs.length}`);
  assert(winnerFees.reactorFeeCount === 1 && winnerFees.aggregateProtocolImpactBps === 350, "winner one 3.5% terminal");
  assert(
    winnerFees.feeLegs[0]!.tokenIn.toLowerCase() === ZCAT.toLowerCase() &&
      winnerFees.feeLegs[0]!.tokenOut.toLowerCase() === CAT.toLowerCase(),
    "winner fee leg is ZCAT→CAT terminal",
  );
  assert(winnerFees.feeLegs[0]!.kind === VENUE.OFFICIAL_REACTOR_V4, "winner terminal kind");
  assert(winnerFees.feeLegs[0]!.notionalQuote === "9400", `winner notional ${winnerFees.feeLegs[0]!.notionalQuote}`);
  assert(
    !winnerFees.feeLegs.some((f) => f.tokenIn.toLowerCase() === ZEC.toLowerCase()),
    "winner must not disclose fat official ZEC→ZCAT",
  );

  assert(loserFees.feeLegs.length === 2, `loser feeLegs ${loserFees.feeLegs.length}`);
  const loserZecZcat = loserFees.feeLegs.find(
    (f) => f.tokenIn.toLowerCase() === ZEC.toLowerCase() && f.tokenOut.toLowerCase() === ZCAT.toLowerCase(),
  );
  const loserZcatCat = loserFees.feeLegs.find(
    (f) => f.tokenIn.toLowerCase() === ZCAT.toLowerCase() && f.tokenOut.toLowerCase() === CAT.toLowerCase(),
  );
  assert(loserZecZcat, "loser would have disclosed official ZEC→ZCAT");
  assert(loserZecZcat!.kind === VENUE.OFFICIAL_REACTOR_V4, "loser intermediate kind official");
  assert(loserZecZcat!.notionalQuote === "9800", `loser ZEC→ZCAT notional ${loserZecZcat!.notionalQuote}`);
  assert(loserZcatCat!.notionalQuote === "9700", `loser ZCAT→CAT notional ${loserZcatCat!.notionalQuote}`);
  assert(winnerFees.feeLegs[0]!.notionalQuote !== loserZecZcat!.notionalQuote, "must not stamp loser intermediate notional");
  assert(winnerFees.feeLegs[0]!.notionalQuote !== loserZcatCat!.notionalQuote, "must not stamp loser terminal notional");
  assert(hops[0]!.kind === VENUE.EXTERNAL_V4_HOOKLESS, "winner routing kind is hookless");
  assert(hops[0]!.amountOut === "9400", "winner routing out");
}

console.log("quote-integrity tests ok");
