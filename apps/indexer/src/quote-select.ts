/**
 * Atomic quote-ticket assembly.
 *
 * `buildQuote` used to keep `bestPreview` (max finalOut) separately from
 * `pickBest(scored)`. Those can be different candidates. The ticket must take
 * hops, path, kinds, amountOut, hop minOuts, and the terminal market-leg from
 * **one** winner.
 *
 * UserRouteQuoter.PreviewRoute allocates hopOuts/kinds as `hops.length + 1`:
 * the extra element is the official/bonding market leg. BUY appends it;
 * SELL prepends it. `amountOut` is always the final token (BUY) or USDC (SELL).
 */
import { decodeErrorResult, encodeErrorResult, keccak256, parseAbi, toBytes } from "viem";
import { applyMinOuts, pickBest, scoreRoute, RouteReject, VENUE, type PlannedRoute, type ScoredRoute } from "../../../packages/reactor/src/routes.ts";
import { applySlippage, type QuoteHop } from "../../../packages/reactor/src/quote.ts";

export type QuoteSide = "BUY" | "SELL";

export const PREVIEW_ROUTE_ABI = parseAbi([
  "error PreviewRoute(uint256 amountOut, uint256[] hopOuts, bytes32[] kinds)",
]);

export const KIND_HASH = {
  OFFICIAL_REACTOR_V4: keccak256(toBytes("OFFICIAL_REACTOR_V4")),
  EXTERNAL_V4_HOOKLESS: keccak256(toBytes("EXTERNAL_V4_HOOKLESS")),
  BONDING_CURVE: keccak256(toBytes("BONDING_CURVE")),
} as const;

const KIND_NAME: Record<string, string> = {
  [KIND_HASH.OFFICIAL_REACTOR_V4]: VENUE.OFFICIAL_REACTOR_V4,
  [KIND_HASH.EXTERNAL_V4_HOOKLESS]: VENUE.EXTERNAL_V4_HOOKLESS,
  [KIND_HASH.BONDING_CURVE]: VENUE.BONDING_CURVE,
};

export function kindName(k: `0x${string}` | string): string {
  return KIND_NAME[k.toLowerCase()] ?? KIND_NAME[k] ?? VENUE.EXTERNAL_V4_HOOKLESS;
}

export type AtomicRoutePreview = {
  amountOut: bigint;
  hopOuts: bigint[];
  kinds: string[];
};

export type PreviewedRoute = ScoredRoute & {
  preview: AtomicRoutePreview;
  side: QuoteSide;
};

export type SplitPreview = {
  routingOuts: bigint[];
  routingKinds: string[];
  terminalOut: bigint;
  terminalKind: string;
  amountOut: bigint;
};

/** Same hop-count heuristics `buildQuote` applies before pickBest. */
export function quoteScoreOpts(hopCount: number): {
  impactBps: number;
  gasEstimate: number;
  reliabilityBps: number;
} {
  return {
    impactBps: hopCount * 10,
    gasEstimate: hopCount * 90_000,
    reliabilityBps: 9_000 - hopCount * 200,
  };
}

export function encodePreviewRoute(amountOut: bigint, hopOuts: bigint[], kinds: readonly `0x${string}`[]): `0x${string}` {
  return encodeErrorResult({
    abi: PREVIEW_ROUTE_ABI,
    errorName: "PreviewRoute",
    args: [amountOut, hopOuts, kinds],
  });
}

export function decodePreviewRoute(data: `0x${string}`): AtomicRoutePreview {
  const decoded = decodeErrorResult({ abi: PREVIEW_ROUTE_ABI, data });
  if (decoded.errorName !== "PreviewRoute") throw new RouteReject("not PreviewRoute");
  const [amountOut, hopOuts, kinds] = decoded.args as [bigint, bigint[], `0x${string}`[]];
  return { amountOut, hopOuts, kinds: kinds.map(kindName) };
}

export function previewedRoute(
  planned: PlannedRoute,
  preview: AtomicRoutePreview,
  scoreOpts: { impactBps: number; gasEstimate: number; reliabilityBps: number },
  side: QuoteSide,
): PreviewedRoute {
  return {
    ...scoreRoute(planned, { amountOut: preview.amountOut, ...scoreOpts }),
    preview,
    side,
  };
}

/**
 * Real PreviewRoute is plannedHops + terminal official/bonding leg.
 * Empty hopOuts/kinds is the undeployed-quoter executor fallback.
 */
export function assertAtomicPreview(winner: PreviewedRoute): void {
  const { hops, preview } = winner;
  if (!preview) throw new RouteReject("selected route missing atomic preview");
  const empty = preview.hopOuts.length === 0 && preview.kinds.length === 0;
  if (empty) return;
  if (preview.hopOuts.length !== hops.length + 1 || preview.kinds.length !== hops.length + 1) {
    throw new RouteReject("PreviewRoute hopOuts/kinds must be plannedHops.length + 1 (terminal market leg)");
  }
}

/** BUY: routing hops then terminal. SELL: terminal then routing hops. */
export function splitPreviewRoute(winner: PreviewedRoute): SplitPreview {
  assertAtomicPreview(winner);
  const { hops, preview, side } = winner;
  const n = hops.length;
  if (preview.hopOuts.length === 0 && preview.kinds.length === 0) {
    return {
      routingOuts: hops.map(() => 0n),
      routingKinds: hops.map(() => VENUE.EXTERNAL_V4_HOOKLESS),
      terminalOut: preview.amountOut,
      terminalKind: VENUE.EXTERNAL_V4_HOOKLESS,
      amountOut: preview.amountOut,
    };
  }
  if (side === "BUY") {
    return {
      routingOuts: preview.hopOuts.slice(0, n),
      routingKinds: preview.kinds.slice(0, n),
      terminalOut: preview.hopOuts[n]!,
      terminalKind: preview.kinds[n]!,
      amountOut: preview.amountOut,
    };
  }
  return {
    routingOuts: preview.hopOuts.slice(1),
    routingKinds: preview.kinds.slice(1),
    terminalOut: preview.hopOuts[0]!,
    terminalKind: preview.kinds[0]!,
    amountOut: preview.amountOut,
  };
}

/** Winner is pickBest. The entire PreviewRoute stays on that same candidate. */
export function selectAtomicQuotedRoute(scored: PreviewedRoute[]): PreviewedRoute {
  const winner = pickBest(scored) as PreviewedRoute;
  assertAtomicPreview(winner);
  return winner;
}

export function hopsFromAtomicPreview(winner: PreviewedRoute, amountIn: bigint): QuoteHop[] {
  const split = splitPreviewRoute(winner);
  const hops: QuoteHop[] = [];
  for (let i = 0; i < winner.hops.length; i++) {
    const out = split.routingOuts[i] ?? 0n;
    const inbound = i === 0 ? (winner.side === "SELL" ? split.terminalOut : amountIn) : (split.routingOuts[i - 1] ?? 0n);
    hops.push({
      ...winner.hops[i]!,
      minOut: 0n,
      amountIn: inbound.toString(),
      amountOut: out.toString(),
      impactBps: 0,
      gasEstimate: 90_000,
      reliabilityBps: 8_500,
      feeExempt: false,
      kind: split.routingKinds[i] ?? VENUE.EXTERNAL_V4_HOOKLESS,
    });
  }
  return hops;
}

export function assembleAtomicTicket(
  winner: PreviewedRoute,
  amountIn: bigint,
  slipBps: number,
): {
  hops: QuoteHop[];
  path: string[];
  amountOut: bigint;
  minOut: bigint;
  terminalOut: bigint;
  terminalKind: string;
  terminalMinOut: bigint;
} {
  const split = splitPreviewRoute(winner);
  const hops = hopsFromAtomicPreview(winner, amountIn);
  const stamped = hops.length
    ? applyMinOuts(
        { hops, path: winner.path, reason: winner.reason },
        hops.map((h) => applySlippage(BigInt(h.amountOut), slipBps)),
      )
    : { hops, path: winner.path, reason: winner.reason };
  for (let i = 0; i < hops.length; i++) hops[i] = { ...hops[i]!, minOut: stamped.hops[i]!.minOut };
  return {
    hops,
    path: winner.path,
    amountOut: split.amountOut,
    minOut: applySlippage(split.amountOut, slipBps),
    terminalOut: split.terminalOut,
    terminalKind: split.terminalKind,
    terminalMinOut: applySlippage(split.terminalOut, slipBps),
  };
}
