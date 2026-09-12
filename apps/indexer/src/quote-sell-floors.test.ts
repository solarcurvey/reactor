/**
 * Issue #4 — routed SELL minQuoteOut is first-leg quoteOut, never tokenIn.
 *
 * Floors consume the shared #21 PreviewedRoute / splitPreviewRoute
 * (plannedHops + 1). Covers 6/8/18-dec quotes, bonding + graduated
 * direct-to-USDC, nested CAT→ZCAT→ZEC→USDC, calldata decode, fail-closed.
 */
import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import { applySlippage } from "../../../packages/reactor/src/quote.ts";
import { VENUE, type PlannedRoute } from "../../../packages/reactor/src/routes.ts";
import {
  KIND_HASH,
  encodePreviewRoute,
  decodePreviewRoute,
  previewedRoute,
  quoteScoreOpts,
  splitPreviewRoute,
} from "./quote-select.ts";
import { sellFloorsFromDirectQuote, sellFloorsFromSelected, SellPreviewFailed } from "./sell-floors.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const userSellAbi = parseAbi([
  "function sell(address token, uint256 tokenIn, (address adapter,address tokenIn,address tokenOut,uint256 minOut,bytes data)[] hops, uint256 minQuoteOut, uint256 minFinalOut, uint256 deadline) returns (uint256)",
]);

const TOKEN = "0x00000000000000000000000000000000000000ca" as const;
const USDC = "0x0000000000000000000000000000000000000001" as const;
const ZEC = "0x0000000000000000000000000000000000000002" as const;
const ZCAT = "0x0000000000000000000000000000000000000003" as const;
const ADAPTER = "0x00000000000000000000000000000000000000aa" as const;

const SLIP = 100;

function encodeSell(args: {
  tokenIn: bigint;
  hops: { adapter: `0x${string}`; tokenIn: `0x${string}`; tokenOut: `0x${string}`; minOut: bigint; data: `0x${string}` }[];
  minQuoteOut: bigint;
  minFinalOut: bigint;
}) {
  return encodeFunctionData({
    abi: userSellAbi,
    functionName: "sell",
    args: [TOKEN, args.tokenIn, args.hops, args.minQuoteOut, args.minFinalOut, 1_700_000_000n],
  });
}

function decodeSell(data: `0x${string}`) {
  const decoded = decodeFunctionData({ abi: userSellAbi, data });
  if (decoded.functionName !== "sell") throw new Error("not sell");
  const [, tokenIn, hops, minQuoteOut, minFinalOut] = decoded.args as [
    `0x${string}`,
    bigint,
    { minOut: bigint }[],
    bigint,
    bigint,
    bigint,
  ];
  return { tokenIn, hops, minQuoteOut, minFinalOut };
}

function hop(tokenIn: `0x${string}`, tokenOut: `0x${string}`, data: `0x${string}` = "0x02") {
  return { adapter: ADAPTER, tokenIn, tokenOut, minOut: 0n, data };
}

function buggyMinQuoteOut(tokenIn: bigint) {
  return applySlippage(tokenIn, SLIP);
}

function sellWinner(planned: PlannedRoute, amountOut: bigint, hopOuts: bigint[], kinds: readonly `0x${string}`[]) {
  const raw = encodePreviewRoute(amountOut, hopOuts, kinds);
  const preview = decodePreviewRoute(raw);
  return previewedRoute(planned, preview, quoteScoreOpts(planned.hops.length), "SELL");
}

{
  const cases: Array<{ label: string; decimals: number; tokenIn: bigint; quoteOut: bigint }> = [
    { label: "USDC-6", decimals: 6, tokenIn: 10n ** 18n, quoteOut: 50n * 10n ** 6n },
    { label: "ZEC-8", decimals: 8, tokenIn: 10n ** 18n, quoteOut: 2n * 10n ** 8n },
    { label: "18Q-18", decimals: 18, tokenIn: 10n ** 18n, quoteOut: 3n * 10n ** 17n },
  ];
  for (const c of cases) {
    const ticket = sellFloorsFromDirectQuote({
      tokenIn: c.tokenIn,
      quoteOut: c.quoteOut,
      slipBps: SLIP,
      path: [TOKEN, USDC],
    });
    assert(ticket.minQuoteOut === applySlippage(c.quoteOut, SLIP), `${c.label} minQuoteOut is slipped quoteOut`);
    assert(ticket.minFinalOut === applySlippage(c.quoteOut, SLIP), `${c.label} minFinalOut is slipped quoteOut`);
    assert(ticket.minQuoteOut !== buggyMinQuoteOut(c.tokenIn), `${c.label} minQuoteOut ≠ slipped tokenIn`);
  }
  console.log("decimals 6/8/18: minQuoteOut is quote units ok");
}

{
  const tokenIn = 5n * 10n ** 18n;
  const quoteOut = 12_345_678n;
  const ticket = sellFloorsFromDirectQuote({
    tokenIn,
    quoteOut,
    firstLegKind: VENUE.BONDING_CURVE,
    slipBps: SLIP,
    path: [TOKEN, USDC],
  });
  assert(ticket.hops.length === 0, "direct bonding: no route hops");
  assert(ticket.minQuoteOut === applySlippage(quoteOut, SLIP), "bonding minQuoteOut from USDC quoteOut");
  assert(ticket.minFinalOut === applySlippage(quoteOut, SLIP), "bonding minFinalOut from USDC quoteOut");
  const data = encodeSell({
    tokenIn,
    hops: ticket.hops,
    minQuoteOut: ticket.minQuoteOut,
    minFinalOut: ticket.minFinalOut,
  });
  const got = decodeSell(data);
  assert(got.minQuoteOut === ticket.minQuoteOut, "bonding calldata minQuoteOut");
  assert(got.minFinalOut === ticket.minFinalOut, "bonding calldata minFinalOut");
  console.log("bonding sell direct-to-USDC ok");
}

{
  const tokenIn = 7n * 10n ** 18n;
  const quoteOut = 99_000_000n;
  const ticket = sellFloorsFromDirectQuote({
    tokenIn,
    quoteOut,
    firstLegKind: VENUE.OFFICIAL_REACTOR_V4,
    slipBps: SLIP,
    path: [TOKEN, USDC],
  });
  assert(ticket.firstLegKind === VENUE.OFFICIAL_REACTOR_V4, "graduated first-leg kind");
  assert(ticket.minQuoteOut === applySlippage(quoteOut, SLIP), "graduated minQuoteOut from USDC quoteOut");
  const data = encodeSell({
    tokenIn,
    hops: [],
    minQuoteOut: ticket.minQuoteOut,
    minFinalOut: ticket.minFinalOut,
  });
  const got = decodeSell(data);
  assert(got.minQuoteOut === applySlippage(quoteOut, SLIP), "graduated calldata minQuoteOut");
  assert(got.minFinalOut === applySlippage(quoteOut, SLIP), "graduated calldata minFinalOut");
  console.log("graduated sell direct-to-USDC ok");
}

{
  const tokenIn = 10n ** 18n;
  const zcatOut = 4n * 10n ** 17n;
  const zecOut = 15n * 10n ** 7n;
  const usdcOut = 45n * 10n ** 6n;
  const planned: PlannedRoute = {
    hops: [hop(ZCAT, ZEC, "0x11"), hop(ZEC, USDC, "0x22")],
    path: [ZCAT, ZEC, USDC],
    reason: "ok ZCAT→ZEC→USDC",
  };
  const winner = sellWinner(
    planned,
    usdcOut,
    [zcatOut, zecOut, usdcOut],
    [KIND_HASH.OFFICIAL_REACTOR_V4, KIND_HASH.EXTERNAL_V4_HOOKLESS, KIND_HASH.EXTERNAL_V4_HOOKLESS],
  );
  assert(winner.preview.hopOuts.length === planned.hops.length + 1, "PreviewRoute is plannedHops+1");
  const split = splitPreviewRoute(winner);
  assert(split.terminalOut === zcatOut, "shared split: terminal is first-leg ZCAT");
  assert(split.routingOuts[0] === zecOut && split.routingOuts[1] === usdcOut, "shared split: routing hops");
  assert(split.amountOut === usdcOut, "shared split: final USDC");

  const ticket = sellFloorsFromSelected(winner, tokenIn, SLIP);
  assert(ticket.firstLegQuoteOut === split.terminalOut, "floors consume split.terminalOut");
  assert(ticket.minQuoteOut === applySlippage(split.terminalOut, SLIP), "minQuoteOut = slip(terminalOut)");
  assert(ticket.minFinalOut === applySlippage(split.amountOut, SLIP), "minFinalOut = slip(amountOut)");
  assert(ticket.hops[0]!.amountIn === zcatOut.toString(), "first hop amountIn is ZCAT, not tokenIn");
  assert(ticket.hops[0]!.minOut === applySlippage(zecOut, SLIP), "hop0 minOut = slip(ZEC)");
  assert(ticket.hops[1]!.minOut === applySlippage(usdcOut, SLIP), "hop1 minOut = slip(USDC)");
  assert(ticket.minQuoteOut !== buggyMinQuoteOut(tokenIn), "nested minQuoteOut ≠ slip(tokenIn)");

  const data = encodeSell({
    tokenIn,
    hops: ticket.hops,
    minQuoteOut: ticket.minQuoteOut,
    minFinalOut: ticket.minFinalOut,
  });
  const got = decodeSell(data);
  assert(got.minQuoteOut === ticket.minQuoteOut, "nested calldata minQuoteOut matches ticket");
  assert(got.minFinalOut === ticket.minFinalOut, "nested calldata minFinalOut matches ticket");
  assert(got.minQuoteOut === applySlippage(winner.preview.hopOuts[0]!, SLIP), "decoded minQuoteOut from same atomic preview");
  assert(got.minFinalOut === applySlippage(winner.preview.amountOut, SLIP), "decoded minFinalOut from same atomic preview");
  console.log("nested CAT→ZCAT→ZEC→USDC sell ok");
}

{
  const planned: PlannedRoute = {
    hops: [hop(ZEC, USDC)],
    path: [ZEC, USDC],
    reason: "ok",
  };
  const failures: Array<{ label: string; run: () => void }> = [
    {
      label: "missing hopOuts",
      run: () =>
        sellFloorsFromSelected(
          previewedRoute(planned, { amountOut: 1_000_000n, hopOuts: [], kinds: [] }, quoteScoreOpts(1), "SELL"),
          10n ** 18n,
          SLIP,
        ),
    },
    {
      label: "malformed hopOuts length",
      run: () =>
        sellFloorsFromSelected(
          previewedRoute(
            planned,
            { amountOut: 1_000_000n, hopOuts: [1_000_000n], kinds: [VENUE.OFFICIAL_REACTOR_V4] },
            quoteScoreOpts(1),
            "SELL",
          ),
          10n ** 18n,
          SLIP,
        ),
    },
    {
      label: "dust first-leg",
      run: () =>
        sellFloorsFromSelected(
          sellWinner(planned, 1_000_000n, [1n, 1_000_000n], [KIND_HASH.BONDING_CURVE, KIND_HASH.EXTERNAL_V4_HOOKLESS]),
          10n ** 18n,
          SLIP,
        ),
    },
    {
      label: "direct dust",
      run: () => sellFloorsFromDirectQuote({ tokenIn: 10n ** 18n, quoteOut: 1n, slipBps: SLIP, path: [TOKEN, USDC] }),
    },
  ];
  for (const f of failures) {
    let threw = false;
    try {
      f.run();
    } catch (e) {
      threw = e instanceof SellPreviewFailed || e instanceof Error;
    }
    assert(threw, `${f.label} must not produce an executable quote`);
  }
  console.log("exact preview failure returns no executable quote ok");
}

{
  const tokenIn = 10n ** 18n;
  const winner = sellWinner(
    { hops: [hop(ZEC, USDC, "0x03")], path: [ZEC, USDC], reason: "winner" },
    8_000_000n,
    [2n * 10n ** 8n, 8_000_000n],
    [KIND_HASH.OFFICIAL_REACTOR_V4, KIND_HASH.EXTERNAL_V4_HOOKLESS],
  );
  const other = sellWinner(
    { hops: [hop(ZEC, USDC, "0x99")], path: [ZEC, USDC], reason: "other" },
    9_900_000n,
    [3n * 10n ** 8n, 9_900_000n],
    [KIND_HASH.BONDING_CURVE, KIND_HASH.EXTERNAL_V4_HOOKLESS],
  );
  const ticket = sellFloorsFromSelected(winner, tokenIn, SLIP);
  const split = splitPreviewRoute(winner);
  assert(ticket.minQuoteOut === applySlippage(split.terminalOut, SLIP), "floors from winner split");
  assert(ticket.minQuoteOut !== applySlippage(splitPreviewRoute(other).terminalOut, SLIP), "must not use other candidate");
  console.log("same-candidate sell floors via splitPreviewRoute ok");
}

console.log("quote-sell-floors tests ok");
