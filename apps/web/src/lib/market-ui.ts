import type { LaunchToken } from "./hooks";
import { formatUnitsSafe } from "./utils";

export type BoardFilter =
  | "Trending"
  | "New"
  | "Bonding"
  | "Rewards"
  | "Buy+Burn"
  | "Batch Fair"
  | "USDC-quoted";

export function marketHref(t: Pick<LaunchToken, "mode" | "marketLive" | "fairId" | "token">): string {
  if (t.mode === 1 && !t.marketLive) return `/fair/${t.fairId}`;
  return `/token/${t.token}`;
}

export function earnsLabel(t: Pick<LaunchToken, "rewardsMode" | "quoteSymbol">): string {
  return t.rewardsMode === false ? "BUY+BURN" : `EARNS ${t.quoteSymbol ?? "X"}`;
}

export function stageLabel(t: LaunchToken): string {
  if (t.mode === 1) return t.marketLive ? "Fair · live" : "Fair · auction";
  if (t.ready && !t.marketLive) return "Frozen · ready";
  if (t.bonding && !t.marketLive) return `${bondingPct(t).toFixed(0)}% bonded`;
  if (t.marketLive) return "Instant · v4";
  return "Not live";
}

export function bondingPct(t: Pick<LaunchToken, "bondingBps">): number {
  return Math.min(100, Math.max(0, (t.bondingBps ?? 0) / 100));
}

/** Frozen Instant: no buys or sells until graduate. */
export function isReadyFrozen(t: Pick<LaunchToken, "ready" | "marketLive">): boolean {
  return Boolean(t.ready && !t.marketLive);
}

export function canTrade(t: Pick<LaunchToken, "ready" | "marketLive" | "bonding">): boolean {
  if (isReadyFrozen(t)) return false;
  return Boolean(t.marketLive || t.bonding);
}

export function formatChange24h(bps?: string | number | null): string {
  if (bps === undefined || bps === null || bps === "") return "—";
  const n = typeof bps === "number" ? bps : Number(bps);
  if (!Number.isFinite(n)) return "—";
  const pct = n / 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(Math.abs(pct) >= 100 ? 0 : 2)}%`;
}

export function change24hTone(bps?: string | number | null): "up" | "down" | "flat" {
  if (bps === undefined || bps === null || bps === "") return "flat";
  const n = typeof bps === "number" ? bps : Number(bps);
  if (!Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

export function formatUsd6Compact(raw?: string | bigint | null): string {
  if (raw === undefined || raw === null || raw === "" || raw === "0") return "—";
  try {
    const n = Number(typeof raw === "bigint" ? raw : BigInt(raw)) / 1e6;
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
    if (n >= 10) return `$${n.toFixed(0)}`;
    return `$${n.toFixed(2)}`;
  } catch {
    return "—";
  }
}

export function formatPriceX18(raw?: string | null, digits = 6): string {
  if (!raw || raw === "0") return "—";
  try {
    return formatUnitsSafe(BigInt(raw), 18, digits);
  } catch {
    return "—";
  }
}

export function primaryActionLabel(t: LaunchToken): string {
  if (t.mode === 1 && !t.marketLive) return "Auction";
  if (isReadyFrozen(t)) return "Graduate";
  return "Trade";
}

export function featuredMarkets(items: LaunchToken[]): { bonding: LaunchToken | null; volume: LaunchToken | null } {
  const bonding = [...items]
    .filter((t) => t.bonding && !t.marketLive && !t.ready)
    .sort((a, b) => (b.bondingBps ?? 0) - (a.bondingBps ?? 0))[0] ?? null;
  const volume =
    [...items]
      .filter((t) => t.token.toLowerCase() !== bonding?.token.toLowerCase())
      .filter((t) => t.marketLive || (t.bonding && !t.ready))
      .sort((a, b) => usd6Num(b.volume24hUsd6) - usd6Num(a.volume24hUsd6))[0] ?? null;
  return { bonding, volume };
}

export function usd6Num(raw?: string | null): number {
  if (!raw || raw === "0") return 0;
  try {
    return Number(BigInt(raw));
  } catch {
    return 0;
  }
}

/** Honest close series for a spark — empty when the indexer has no candles. */
export function sparkCloses(candles: { c: string; n?: number }[] | undefined): number[] {
  if (!candles?.length) return [];
  const pts = candles
    .map((c) => {
      try {
        return Number(BigInt(c.c)) / 1e18;
      } catch {
        return 0;
      }
    })
    .filter((n) => n > 0);
  return pts.slice(-24);
}
