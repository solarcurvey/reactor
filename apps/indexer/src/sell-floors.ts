/**
 * Routed SELL safety floors on top of the shared #21 PreviewedRoute.
 *
 * Does not re-split hopOuts. `splitPreviewRoute` already isolates:
 *   terminalOut  = first-leg quoteOut (SELL prepends the official/bonding slot)
 *   routingOuts  = subsequent quote → … → USDC hops
 *   amountOut    = final USDC
 *
 * Slippage is applied by `assembleAtomicTicket`:
 *   terminalMinOut → minQuoteOut
 *   minOut         → minFinalOut
 *   hop.minOut     → each routing hop
 *
 * Never derive minQuoteOut from tokenIn.
 */
import { applySlippage } from "../../../packages/reactor/src/quote.ts";
import { VENUE, type PlannedRoute } from "../../../packages/reactor/src/routes.ts";
import {
  assembleAtomicTicket,
  previewedRoute,
  quoteScoreOpts,
  splitPreviewRoute,
  type PreviewedRoute,
} from "./quote-select.ts";

export class SellPreviewFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellPreviewFailed";
  }
}

export type AssembledSellQuote = {
  hops: ReturnType<typeof assembleAtomicTicket>["hops"];
  path: string[];
  firstLegQuoteOut: bigint;
  firstLegKind: string;
  amountOut: bigint;
  minQuoteOut: bigint;
  minFinalOut: bigint;
};

export function assertMinQuoteOutNotTokenIn(opts: {
  minQuoteOut: bigint;
  tokenIn: bigint;
  firstLegQuoteOut: bigint;
  slipBps: number;
}): void {
  const expected = applySlippage(opts.firstLegQuoteOut, opts.slipBps);
  if (opts.minQuoteOut !== expected) {
    throw new SellPreviewFailed("minQuoteOut must be slipped first-leg quoteOut");
  }
  if (opts.firstLegQuoteOut === opts.tokenIn) return;
  let slippedTokenIn: bigint | undefined;
  try {
    slippedTokenIn = applySlippage(opts.tokenIn, opts.slipBps);
  } catch {
    slippedTokenIn = undefined;
  }
  if (slippedTokenIn !== undefined && opts.minQuoteOut === slippedTokenIn) {
    throw new SellPreviewFailed("minQuoteOut must not be derived from tokenIn");
  }
}

/** Atomic SELL: floors from the same selected PreviewedRoute as #21. */
export function sellFloorsFromSelected(winner: PreviewedRoute, tokenIn: bigint, slipBps: number): AssembledSellQuote {
  if (winner.side !== "SELL") throw new SellPreviewFailed("sell floors require a SELL PreviewedRoute");
  if (winner.preview.hopOuts.length === 0) {
    throw new SellPreviewFailed("exact sell preview failed — missing first-leg quoteOut");
  }
  const split = splitPreviewRoute(winner);
  if (split.terminalOut <= 1n) throw new SellPreviewFailed("exact sell preview failed — first-leg quoteOut dust");
  if (split.amountOut <= 1n) throw new SellPreviewFailed("exact sell preview failed — final USDC dust");
  if (split.routingOuts.some((o) => o <= 1n)) {
    throw new SellPreviewFailed("exact sell preview failed — hop quote is dust");
  }
  let ticket: ReturnType<typeof assembleAtomicTicket>;
  try {
    ticket = assembleAtomicTicket(winner, tokenIn, slipBps);
  } catch (e) {
    throw new SellPreviewFailed(e instanceof Error ? e.message : "exact sell preview failed — dust after slippage");
  }
  if (ticket.terminalMinOut !== applySlippage(split.terminalOut, slipBps)) {
    throw new SellPreviewFailed("minQuoteOut must come from splitPreviewRoute terminalOut");
  }
  if (ticket.minOut !== applySlippage(split.amountOut, slipBps)) {
    throw new SellPreviewFailed("minFinalOut must come from the same preview amountOut");
  }
  assertMinQuoteOutNotTokenIn({
    minQuoteOut: ticket.terminalMinOut,
    tokenIn,
    firstLegQuoteOut: split.terminalOut,
    slipBps,
  });
  return {
    hops: ticket.hops,
    path: ticket.path,
    firstLegQuoteOut: split.terminalOut,
    firstLegKind: split.terminalKind,
    amountOut: ticket.amountOut,
    minQuoteOut: ticket.terminalMinOut,
    minFinalOut: ticket.minOut,
  };
}

/** Bonding/graduated sell whose market quote is already USDC (no route hops). */
export function sellFloorsFromDirectQuote(args: {
  tokenIn: bigint;
  quoteOut: bigint;
  firstLegKind?: string;
  slipBps: number;
  path: string[];
}): AssembledSellQuote {
  const planned: PlannedRoute = { hops: [], path: args.path, reason: "direct" };
  const kind = args.firstLegKind ?? VENUE.OFFICIAL_REACTOR_V4;
  const winner = previewedRoute(
    planned,
    { amountOut: args.quoteOut, hopOuts: [args.quoteOut], kinds: [kind] },
    quoteScoreOpts(0),
    "SELL",
  );
  return sellFloorsFromSelected(winner, args.tokenIn, args.slipBps);
}
