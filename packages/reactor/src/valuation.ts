/**
 * Shared ValuationEngine — Top-10, launch pricing, UI, quote ecosystem, route sanity.
 * Recursive nested quotes (CAT / ZCAT / ZEC / USD). Rejects cycles. Max depth 3.
 * Only usdPegOne assets are $1. EURC / Stablecoins category is not.
 */

export const MAX_VALUATION_DEPTH = 3;
export const USDC_ONE = 1_000_000n;

export type QuoteNode = {
  token: string;
  symbol: string;
  decimals: number;
  usdPegOne: boolean;
  quarantined?: boolean;
  parentQuote?: string;
  /** Offchain multi-source USD-6 per 1 whole token. */
  externalUsd6?: bigint;
  externalOk?: boolean;
  externalStale?: boolean;
};

export type ValuationResult = {
  usd6: bigint;
  ok: boolean;
  reason: string;
  depth: number;
  path: string[];
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
  if (depth > MAX_VALUATION_DEPTH) {
    return { usd6: 0n, ok: false, reason: "max depth", depth, path };
  }
  if (stack.has(key)) {
    throw new CycleError(key);
  }
  const node = nodes.get(key);
  if (!node) return { usd6: 0n, ok: false, reason: "unknown quote", depth, path };
  if (node.quarantined) return { usd6: 0n, ok: false, reason: "quarantined", depth, path };
  if (node.usdPegOne) return { usd6: USDC_ONE, ok: true, reason: "usdPegOne", depth, path };

  if (node.externalOk && node.externalUsd6 && node.externalUsd6 > 0n && !node.externalStale) {
    return { usd6: node.externalUsd6, ok: true, reason: "external", depth, path };
  }

  if (node.parentQuote) {
    stack.add(key);
    const parent = valueQuoteUsd6(node.parentQuote, nodes, depth + 1, stack);
    stack.delete(key);
    if (!parent.ok) return { ...parent, depth, path };
    return { usd6: parent.usd6, ok: true, reason: `nested:${parent.reason}`, depth: depth + 1, path };
  }

  return { usd6: 0n, ok: false, reason: "unpriced", depth, path };
}

/** Multi-source + Arc sanity. Fail closed on stale / deviation. */
export function fuseExternalUsd6(sources: Array<{ usd6: bigint; ts: number; name: string }>, now: number, maxAgeSec = 120, maxDevBps = 150): {
  usd6: bigint;
  ok: boolean;
  reason: string;
} {
  const fresh = sources.filter((s) => s.usd6 > 0n && now - s.ts <= maxAgeSec);
  if (fresh.length === 0) return { usd6: 0n, ok: false, reason: "stale or empty" };
  const mid = fresh.map((s) => s.usd6).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[Math.floor(fresh.length / 2)]!;
  for (const s of fresh) {
    const diff = s.usd6 > mid ? s.usd6 - mid : mid - s.usd6;
    if ((diff * 10_000n) / mid > BigInt(maxDevBps)) {
      return { usd6: 0n, ok: false, reason: `deviation ${s.name}` };
    }
  }
  return { usd6: mid, ok: true, reason: `fused ${fresh.length}` };
}

export function virtualQuote0ForUsd(supply: bigint, quoteDecimals: number, quoteUsd6: bigint): bigint {
  const qUsdc = (5_000n * 1_000_000n * supply) / (1_000_000_000n * 10n ** 18n) || 5_000n * 1_000_000n;
  if (quoteUsd6 === 0n) return 0n;
  return (qUsdc * 10n ** BigInt(quoteDecimals)) / quoteUsd6;
}
