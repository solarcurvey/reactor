import type { Hop } from "./routes.ts";

export type QuoteKind = "BUY" | "SELL" | "MAINTENANCE" | "TOP10" | "SELFBURN" | "CORE";

export type FeeLeg = {
  venue: string;
  tokenIn: string;
  tokenOut: string;
  /** Official REACTOR 3.5% quote-side charge on this hop. */
  protocolFeeBps: number;
  holdersBps: number;
  flywheelBps: number;
  coreBps: number;
  notionalQuote: string;
  holders: string;
  flywheel: string;
  core: string;
  /** Nested routes may charge 3.5% on more than one official hop. */
  reactorOfficial: boolean;
};

export type QuoteHop = Hop & {
  amountIn: string;
  amountOut: string;
  impactBps: number;
  gasEstimate: number;
  reliabilityBps: number;
  feeExempt: boolean;
  kind?: string;
};

export type QuoteRequest = {
  kind: QuoteKind;
  token?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  recipient?: string;
};

export type QuoteResponse = {
  ok: boolean;
  reason?: string;
  requestId: string;
  kind: QuoteKind;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  minOut: string;
  /**
   * SELL only. Floor on the first official/bonding leg, in **quote** units.
   * From `splitPreviewRoute(selected).terminalOut`, never tokenIn.
   */
  minQuoteOut?: string;
  hops: QuoteHop[];
  feeLegs: FeeLeg[];
  /** Nested REACTOR official hops — each 3.5% listed separately. */
  reactorFeeCount: number;
  totalProtocolFeeBps: number;
  impactBps: number;
  expiry: number;
  path: string[];
  tx?: {
    to: string;
    data: string;
    value: string;
    functionName: string;
  };
};

export const REACTOR_FEE_BPS = 350;
export const HOLDER_FEE_BPS = 200;
export const FLYWHEEL_FEE_BPS = 100;
export const CORE_FEE_BPS = 50;
export const QUOTE_TTL_SEC = 30;

export function splitQuoteFee(notional: bigint): { holders: bigint; flywheel: bigint; core: bigint; fee: bigint } {
  const holders = (notional * BigInt(HOLDER_FEE_BPS)) / 10_000n;
  const flywheel = (notional * BigInt(FLYWHEEL_FEE_BPS)) / 10_000n;
  const core = (notional * BigInt(CORE_FEE_BPS)) / 10_000n;
  return { holders, flywheel, core, fee: holders + flywheel + core };
}

export function applySlippage(amount: bigint, slipBps: number): bigint {
  const bps = BigInt(Math.max(1, Math.min(5_000, slipBps)));
  const v = (amount * (10_000n - bps)) / 10_000n;
  if (v <= 1n) throw new Error("minOut is dust after slippage");
  return v;
}
