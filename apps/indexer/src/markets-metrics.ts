/** Quote-side USD liquidity and 24h mark change. Not FDV/5 and not a TVL claim. */

export function change24hBps(nowX18: bigint, thenX18: bigint): string {
  if (thenX18 <= 0n) return "";
  return ((nowX18 - thenX18) * 10_000n / thenX18).toString();
}

export function quoteLiquidityUsd6(quoteRaw: bigint, quoteUsd6: bigint, decimals: number): string {
  if (quoteRaw <= 0n || quoteUsd6 <= 0n || decimals < 0 || decimals > 36) return "0";
  return ((quoteRaw * quoteUsd6) / 10n ** BigInt(decimals)).toString();
}

export function parseBoard(raw: string | null | undefined): {
  stage: string;
  mode: string;
  rewards: string;
  quoteSymbol: string;
  live: string;
  sortHint: "new" | "vol" | "";
} {
  switch (raw) {
    case "bonding":
      return { stage: "bonding", mode: "", rewards: "", quoteSymbol: "", live: "", sortHint: "" };
    case "rewards":
      return { stage: "", mode: "0", rewards: "1", quoteSymbol: "", live: "", sortHint: "" };
    case "burn":
    case "buy+burn":
      return { stage: "", mode: "0", rewards: "0", quoteSymbol: "", live: "", sortHint: "" };
    case "fair":
    case "batch-fair":
      return { stage: "", mode: "1", rewards: "", quoteSymbol: "", live: "", sortHint: "" };
    case "usdc":
    case "usdc-quoted":
      return { stage: "", mode: "", rewards: "", quoteSymbol: "usdc", live: "", sortHint: "" };
    case "trending":
      return { stage: "", mode: "", rewards: "", quoteSymbol: "", live: "1", sortHint: "vol" };
    default:
      return { stage: "", mode: "", rewards: "", quoteSymbol: "", live: "", sortHint: raw === "new" ? "new" : "" };
  }
}
