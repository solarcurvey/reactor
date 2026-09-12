import {
  displayVenueKind,
  isHooklessVenue,
  isOfficialReactorVenue,
  VENUE,
  type Hop,
} from "./routes.ts";

export type QuoteKind = "BUY" | "SELL" | "MAINTENANCE" | "TOP10" | "SELFBURN" | "CORE";

export type FeeLeg = {
  venue: string;
  tokenIn: string;
  tokenOut: string;
  /** Official REACTOR 3.5% quote-side charge on this hop. Zero when fee-exempt or hookless. */
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
  /** Protocol / Keeper / SelfBurn — official edge, no user 3.5%. */
  feeExempt: boolean;
  kind: string;
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
   * Independent of `minOut` (final USDC) and never derived from tokenIn.
   */
  minQuoteOut?: string;
  hops: QuoteHop[];
  /** User-charged official legs only. Hookless and fee-exempt official edges are not here. */
  feeLegs: FeeLeg[];
  /** Official edges on protocol/Keeper routes — disclosed, 0 user fee. */
  exemptOfficialLegs: FeeLeg[];
  /** Nested REACTOR official hops — each 3.5% listed separately. */
  reactorFeeCount: number;
  /** Sum of per-leg official bps (two 3.5% legs = 700). */
  totalProtocolFeeBps: number;
  /**
   * Compound remaining after sequential official 3.5% takes.
   * Two equal 3.5% legs = 688 bps ≈ 6.88% before slippage.
   */
  aggregateProtocolImpactBps: number;
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

export function venueLabel(kind?: string): string {
  const v = displayVenueKind(kind);
  if (v === VENUE.BONDING_CURVE) return "InstantCurve";
  if (v === VENUE.OFFICIAL_REACTOR_V4) return "official-v4";
  return VENUE.EXTERNAL_V4_HOOKLESS;
}

/**
 * Quote-side notional for a hop. Official 3.5% is charged on the quote of that market:
 * buy (quote → token) uses amountIn; sell (token → quote) uses amountOut.
 */
export function hopQuoteNotional(
  hop: { tokenIn: string; tokenOut: string; amountIn: string; amountOut: string },
  quoteTokens: Set<string>,
  side?: "BUY" | "SELL",
): bigint {
  const tin = hop.tokenIn.toLowerCase();
  const tout = hop.tokenOut.toLowerCase();
  const inIsQuote = quoteTokens.has(tin);
  const outIsQuote = quoteTokens.has(tout);
  if (inIsQuote && !outIsQuote) return BigInt(hop.amountIn || "0");
  if (outIsQuote && !inIsQuote) return BigInt(hop.amountOut || "0");
  // Nested quote tokens (ZEC and ZCAT are both quotes): use route side.
  if (side === "SELL") return BigInt(hop.amountOut || hop.amountIn || "0");
  return BigInt(hop.amountIn || hop.amountOut || "0");
}

export function makeFeeLeg(
  venue: string,
  tokenIn: string,
  tokenOut: string,
  notional: bigint,
  official: boolean,
  feeExempt: boolean,
  kind?: string,
): FeeLeg {
  const charged = official && !feeExempt;
  const split = charged ? splitQuoteFee(notional) : { holders: 0n, flywheel: 0n, core: 0n, fee: 0n };
  return {
    venue,
    tokenIn,
    tokenOut,
    protocolFeeBps: charged ? REACTOR_FEE_BPS : 0,
    holdersBps: charged ? HOLDER_FEE_BPS : 0,
    flywheelBps: charged ? FLYWHEEL_FEE_BPS : 0,
    coreBps: charged ? CORE_FEE_BPS : 0,
    notionalQuote: notional.toString(),
    holders: split.holders.toString(),
    flywheel: split.flywheel.toString(),
    core: split.core.toString(),
    reactorOfficial: official,
    feeExempt,
    kind: kind ? displayVenueKind(kind) : displayVenueKind(official ? VENUE.OFFICIAL_REACTOR_V4 : VENUE.EXTERNAL_V4_HOOKLESS),
  };
}

/** Sequential 3.5% takes compound: two legs → 688 bps (6.88%), not 700. */
export function compoundProtocolImpactBps(feeBps: number[]): number {
  let remaining = 10_000n;
  for (const bps of feeBps) {
    if (bps <= 0) continue;
    remaining = (remaining * (10_000n - BigInt(bps))) / 10_000n;
  }
  return Number(10_000n - remaining);
}

export type FeeSourceHop = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  kind?: string;
  venue?: string;
};

export type FeeDisclosure = {
  feeLegs: FeeLeg[];
  exemptOfficialLegs: FeeLeg[];
  reactorFeeCount: number;
  totalProtocolFeeBps: number;
  aggregateProtocolImpactBps: number;
};

/**
 * Build quote fee disclosure from the selected route hops plus an optional final market leg.
 * Protocol / Keeper routes pass feeExempt=true — official edges go to exemptOfficialLegs only.
 */
export function buildFeeDisclosure(
  hops: FeeSourceHop[],
  opts: {
    feeExempt: boolean;
    quoteTokens?: Set<string>;
    side?: "BUY" | "SELL";
    /** Final official/bonding market when it is not already in `hops`. */
    finalMarket?: FeeSourceHop & { official?: boolean };
  },
): FeeDisclosure {
  const quotes = opts.quoteTokens ?? new Set<string>();
  const seen = new Set<string>();
  const feeLegs: FeeLeg[] = [];
  const exemptOfficialLegs: FeeLeg[] = [];

  const consider = (h: FeeSourceHop, officialOverride?: boolean) => {
    const key = `${h.tokenIn.toLowerCase()}→${h.tokenOut.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const kind = h.kind ?? (officialOverride ? VENUE.OFFICIAL_REACTOR_V4 : undefined);
    const official = officialOverride ?? (isOfficialReactorVenue(kind) && !isHooklessVenue(kind));
    const notional = hopQuoteNotional(h, quotes, opts.side);
    const venue = h.venue ?? venueLabel(kind);
    const leg = makeFeeLeg(venue, h.tokenIn, h.tokenOut, notional, official, opts.feeExempt, kind);
    if (official && opts.feeExempt) {
      exemptOfficialLegs.push(leg);
      return;
    }
    if (official && !opts.feeExempt) {
      feeLegs.push(leg);
    }
  };

  for (const h of hops) consider(h);
  if (opts.finalMarket) {
    consider(opts.finalMarket, opts.finalMarket.official ?? isOfficialReactorVenue(opts.finalMarket.kind));
  }

  const chargedBps = feeLegs.filter((f) => f.reactorOfficial && !f.feeExempt).map((f) => f.protocolFeeBps);
  return {
    feeLegs,
    exemptOfficialLegs,
    reactorFeeCount: feeLegs.filter((f) => f.reactorOfficial).length,
    totalProtocolFeeBps: chargedBps.reduce((s, b) => s + b, 0),
    aggregateProtocolImpactBps: compoundProtocolImpactBps(chargedBps),
  };
}

export function emptyFeeDisclosure(): FeeDisclosure {
  return {
    feeLegs: [],
    exemptOfficialLegs: [],
    reactorFeeCount: 0,
    totalProtocolFeeBps: 0,
    aggregateProtocolImpactBps: 0,
  };
}
