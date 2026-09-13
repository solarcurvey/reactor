import type { QueryClient } from "@tanstack/react-query";
import type { LaunchToken } from "./indexed";

export type LiveEvent = { type: string; data: Record<string, unknown>; id?: number };

export type LiveApplyResult = {
  marketsListRefetch: boolean;
  patches: number;
  ignored: boolean;
};

const PATCH_TYPES = new Set(["trade", "bonding", "graduation", "rewards", "burn", "core"]);

/**
 * SSE must patch cached rows. It must **not** `invalidateQueries` the board
 * (that refetches `/markets` on every print and storms the indexer).
 */
export function applyLiveEventToClient(qc: QueryClient, ev: LiveEvent): LiveApplyResult {
  if (!PATCH_TYPES.has(ev.type)) {
    return { marketsListRefetch: false, patches: 0, ignored: true };
  }
  const token = String(ev.data.token ?? ev.data.address ?? "").toLowerCase();
  if (!token.startsWith("0x") || token.length !== 42) {
    return { marketsListRefetch: false, patches: 0, ignored: true };
  }
  let patches = 0;
  for (const [key, data] of qc.getQueriesData<LaunchToken[]>({ queryKey: ["markets"] })) {
    if (!Array.isArray(data)) continue;
    let hit = false;
    const next = data.map((row) => {
      if (row.token.toLowerCase() !== token) return row;
      hit = true;
      return patchLaunchRow(row, ev);
    });
    if (hit) {
      qc.setQueryData(key, next);
      patches += 1;
    }
  }
  for (const [key, data] of qc.getQueriesData<{ market?: LaunchToken; swaps?: unknown[] }>({
    queryKey: ["token-page", token],
  })) {
    if (!data?.market) continue;
    const swaps = Array.isArray(data.swaps) ? data.swaps : [];
    const nextSwaps =
      ev.type === "trade"
        ? [
            ...swaps,
            {
              t: Number(ev.data.t ?? ev.data.block ?? Date.now()),
              notional: String(ev.data.notional ?? "0"),
              holders: String(ev.data.holders ?? "0"),
              buyback: String(ev.data.buyback ?? "0"),
              source: "sse",
            },
          ]
        : swaps;
    qc.setQueryData(key, {
      ...data,
      market: patchLaunchRow(data.market, ev),
      swaps: nextSwaps,
    });
    patches += 1;
  }
  return { marketsListRefetch: false, patches, ignored: false };
}

function patchLaunchRow(row: LaunchToken, ev: LiveEvent): LaunchToken {
  const notional = ev.data.notional != null ? String(ev.data.notional) : undefined;
  const px = ev.data.px != null ? String(ev.data.px) : ev.data.price_quote_x18 != null ? String(ev.data.price_quote_x18) : undefined;
  return {
    ...row,
    priceQuoteX18: px && px !== "0" ? px : row.priceQuoteX18,
    volume24hUsd6:
      ev.type === "trade" && notional && row.volume24hUsd6
        ? addDecimalStrings(row.volume24hUsd6, notional)
        : row.volume24hUsd6,
  };
}

function addDecimalStrings(a: string, b: string): string {
  try {
    return (BigInt(a) + BigInt(b)).toString();
  } catch {
    return a;
  }
}
