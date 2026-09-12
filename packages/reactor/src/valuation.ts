/**
 * ONE ValuationService — Top-10, launch pricing, UI analytics, quote ecosystem.
 * Recursive nested CAT → ZCAT → ZEC → USD with ancestry.
 * Never copies parent USD. Each hop must have priceInParentX18 or a live external mark.
 * Only usdPegOne assets are $1. EURC / Stablecoins category is not.
 */

import { X18, usd6FromPriceQuote } from "./prices.ts";

export const MAX_VALUATION_DEPTH = 3;
export const USDC_ONE = 1_000_000n;

export type QuoteNode = {
  token: string;
  symbol: string;
  decimals: number;
  usdPegOne: boolean;
  quarantined?: boolean;
  parentQuote?: string;
  /** Quote-normalized price of 1 whole token in the parent, 18 decimals. */
  priceInParentX18?: bigint;
  /** Offchain multi-source USD-6 per 1 whole token. */
  externalUsd6?: bigint;
  externalOk?: boolean;
  externalStale?: boolean;
};

export type AncestryStep = {
  token: string;
  symbol: string;
  usd6: string;
  source: string;
  priceInParentX18?: string;
};

export type ValuationResult = {
  usd6: bigint;
  ok: boolean;
  reason: string;
  depth: number;
  path: string[];
  ancestry: AncestryStep[];
};

export class CycleError extends Error {
  constructor(token: string) {
    super(`valuation cycle at ${token}`);
  }
}

export function valueQuoteUsd6(
  token: string,
  nodes: Map<string, QuoteNode>,
  depth = 0,
  stack: Set<string> = new Set(),
): ValuationResult {
  const key = token.toLowerCase();
  const path = [...stack, key];
  const empty: AncestryStep[] = [];
  if (depth > MAX_VALUATION_DEPTH) {
    return { usd6: 0n, ok: false, reason: "max depth", depth, path, ancestry: empty };
  }
  if (stack.has(key)) {
    throw new CycleError(key);
  }
  const node = nodes.get(key);
  if (!node) return { usd6: 0n, ok: false, reason: "unknown quote", depth, path, ancestry: empty };
  if (node.quarantined) return { usd6: 0n, ok: false, reason: "quarantined", depth, path, ancestry: empty };

  if (node.usdPegOne) {
    return {
      usd6: USDC_ONE,
      ok: true,
      reason: "usdPegOne",
      depth,
      path,
      ancestry: [{ token: key, symbol: node.symbol, usd6: USDC_ONE.toString(), source: "usdPegOne" }],
    };
  }

  if (node.externalOk && node.externalUsd6 && node.externalUsd6 > 0n && !node.externalStale) {
    return {
      usd6: node.externalUsd6,
      ok: true,
      reason: "external",
      depth,
      path,
      ancestry: [{ token: key, symbol: node.symbol, usd6: node.externalUsd6.toString(), source: "external" }],
    };
  }

  if (node.parentQuote) {
    if (!node.priceInParentX18 || node.priceInParentX18 <= 0n) {
      return { usd6: 0n, ok: false, reason: "missing parent price — refuse parent-only USD", depth, path, ancestry: empty };
    }
    stack.add(key);
    const parent = valueQuoteUsd6(node.parentQuote, nodes, depth + 1, stack);
    stack.delete(key);
    if (!parent.ok) return { ...parent, depth, path };
    const usd6 = usd6FromPriceQuote(node.priceInParentX18, parent.usd6);
    if (usd6 === 0n) {
      return { usd6: 0n, ok: false, reason: "nested product underflow", depth, path, ancestry: parent.ancestry };
    }
    return {
      usd6,
      ok: true,
      reason: `nested:${parent.reason}`,
      depth: depth + 1,
      path,
      ancestry: [
        ...parent.ancestry,
        {
          token: key,
          symbol: node.symbol,
          usd6: usd6.toString(),
          source: `×${node.priceInParentX18.toString()}`,
          priceInParentX18: node.priceInParentX18.toString(),
        },
      ],
    };
  }

  return { usd6: 0n, ok: false, reason: "unpriced", depth, path, ancestry: empty };
}

export type ExternalTick = { usd6: bigint; ts: number; name: string };

export type RejectedTick = ExternalTick & { rejectReason: string };

export type FuseOpts = {
  maxAgeSec?: number;
  maxDevBps?: number;
  arcUsd6?: bigint;
  arcMaxDevBps?: number;
  minSources?: number;
};

export type FusedMark = {
  usd6: bigint;
  ok: boolean;
  reason: string;
  n: number;
  accepted: ExternalTick[];
  rejected: RejectedTick[];
};

export const DEFAULT_MAX_AGE_SEC = 120;
export const DEFAULT_MAX_DEV_BPS = 150;
export const DEFAULT_ARC_MAX_DEV_BPS = 400;
/** ValuationService treats a consensus row older than this as stale. */
export const ACCEPTED_MARK_FRESH_SEC = 180;

function parseFuseArgs(
  maxAgeSecOrOpts: number | FuseOpts,
  maxDevBps: number,
  arcUsd6: bigint | undefined,
  arcMaxDevBps: number,
): Required<Pick<FuseOpts, "maxAgeSec" | "maxDevBps" | "arcMaxDevBps" | "minSources">> & Pick<FuseOpts, "arcUsd6"> {
  if (typeof maxAgeSecOrOpts === "object") {
    return {
      maxAgeSec: maxAgeSecOrOpts.maxAgeSec ?? DEFAULT_MAX_AGE_SEC,
      maxDevBps: maxAgeSecOrOpts.maxDevBps ?? DEFAULT_MAX_DEV_BPS,
      arcUsd6: maxAgeSecOrOpts.arcUsd6,
      arcMaxDevBps: maxAgeSecOrOpts.arcMaxDevBps ?? DEFAULT_ARC_MAX_DEV_BPS,
      minSources: maxAgeSecOrOpts.minSources ?? 1,
    };
  }
  return {
    maxAgeSec: maxAgeSecOrOpts,
    maxDevBps,
    arcUsd6,
    arcMaxDevBps,
    minSources: 1,
  };
}

function medianUsd6(ticks: ExternalTick[]): bigint {
  const sorted = ticks.map((s) => s.usd6).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)]!;
}

function bpsAway(value: bigint, ref: bigint): bigint {
  if (ref <= 0n) return 10_000n;
  const diff = value > ref ? value - ref : ref - value;
  return (diff * 10_000n) / ref;
}

/**
 * Multi-source median + staleness + deviation + optional Arc executable-market sanity.
 * Stale/empty prints are rejected observations. A single outlier among ≥3 fresh sources
 * is dropped when enough inliers remain; two-source disagreement fails closed.
 */
export function fuseExternalUsd6(
  sources: ExternalTick[],
  now: number,
  maxAgeSecOrOpts: number | FuseOpts = DEFAULT_MAX_AGE_SEC,
  maxDevBps = DEFAULT_MAX_DEV_BPS,
  arcUsd6?: bigint,
  arcMaxDevBps = DEFAULT_ARC_MAX_DEV_BPS,
): FusedMark {
  const opts = parseFuseArgs(maxAgeSecOrOpts, maxDevBps, arcUsd6, arcMaxDevBps);
  const rejected: RejectedTick[] = [];
  const fresh: ExternalTick[] = [];
  for (const s of sources) {
    if (s.usd6 <= 0n) {
      rejected.push({ ...s, rejectReason: "empty" });
      continue;
    }
    if (now - s.ts > opts.maxAgeSec) {
      rejected.push({ ...s, rejectReason: "stale" });
      continue;
    }
    fresh.push(s);
  }
  const fail = (reason: string, accepted: ExternalTick[] = []): FusedMark => ({
    usd6: 0n,
    ok: false,
    reason,
    n: fresh.length,
    accepted,
    rejected,
  });
  if (fresh.length === 0) return fail("stale or empty");
  if (fresh.length < opts.minSources) return fail(`insufficient sources ${fresh.length}<${opts.minSources}`);

  const mid = medianUsd6(fresh);
  const inliers: ExternalTick[] = [];
  for (const s of fresh) {
    if (bpsAway(s.usd6, mid) > BigInt(opts.maxDevBps)) {
      rejected.push({ ...s, rejectReason: `deviation ${s.name}` });
    } else {
      inliers.push(s);
    }
  }
  const outlierCount = fresh.length - inliers.length;
  if (outlierCount > 0) {
    const canDrop = inliers.length >= opts.minSources && inliers.length >= 2;
    if (!canDrop) {
      const first = rejected.find((r) => r.rejectReason.startsWith("deviation"));
      return fail(first?.rejectReason ?? "deviation", inliers);
    }
    const inlierMid = medianUsd6(inliers);
    for (const s of inliers) {
      if (bpsAway(s.usd6, inlierMid) > BigInt(opts.maxDevBps)) {
        return fail(`deviation ${s.name}`, inliers);
      }
    }
  }
  const accepted = outlierCount > 0 ? inliers : fresh;
  const fused = medianUsd6(accepted);
  if (opts.arcUsd6 && opts.arcUsd6 > 0n) {
    if (bpsAway(fused, opts.arcUsd6) > BigInt(opts.arcMaxDevBps)) {
      return fail("arc sanity", accepted);
    }
  }
  return {
    usd6: fused,
    ok: true,
    reason: `fused ${accepted.length}`,
    n: accepted.length,
    accepted,
    rejected,
  };
}

export function virtualQuote0ForUsd(supply: bigint, quoteDecimals: number, quoteUsd6: bigint): bigint {
  const qUsdc = (5_000n * 1_000_000n * supply) / (1_000_000_000n * 10n ** 18n) || 5_000n * 1_000_000n;
  if (quoteUsd6 === 0n) return 0n;
  return (qUsdc * 10n ** BigInt(quoteDecimals)) / quoteUsd6;
}

/** Single service used by Top-10, launch pricing, UI, quote ecosystem. */
export class ValuationService {
  constructor(private nodes: Map<string, QuoteNode>) {}

  setNodes(nodes: Map<string, QuoteNode>) {
    this.nodes = nodes;
  }

  quoteUsd6(token: string): ValuationResult {
    return valueQuoteUsd6(token, this.nodes);
  }

  tokenUsd6(priceQuoteX18: bigint, quote: string): ValuationResult {
    const q = valueQuoteUsd6(quote, this.nodes);
    if (!q.ok) return q;
    const usd6 = usd6FromPriceQuote(priceQuoteX18, q.usd6);
    return { ...q, usd6, ok: usd6 > 0n, reason: usd6 > 0n ? `token:${q.reason}` : "unpriced token" };
  }

  ancestry(token: string): AncestryStep[] {
    return valueQuoteUsd6(token, this.nodes).ancestry;
  }

  degraded(): boolean {
    for (const n of this.nodes.values()) {
      if (n.usdPegOne) continue;
      if (n.externalStale) return true;
      if (n.parentQuote && (!n.priceInParentX18 || n.priceInParentX18 <= 0n) && !n.externalOk) return true;
    }
    return false;
  }
}

void X18;
