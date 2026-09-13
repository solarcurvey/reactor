"use client";

import { deployment } from "@/lib/addresses";
import { useOfficialChain } from "@/lib/use-official-chain";

export function NetworkBanner() {
  const { chainId, expected, isConnected, matched } = useOfficialChain();
  if (deployment.claimedArcTestnet) return null;
  const wrong = isConnected && !matched;
  return (
    <div
      data-testid="network-banner"
      role="status"
      className={`border-b px-4 py-2 text-center text-[12px] ${
        wrong
          ? "border-red-500/30 bg-red-500/10 text-red-100"
          : "border-cyan-300/15 bg-cyan-300/8 text-cyan-100"
      }`}
    >
      {wrong
        ? `Wrong network (${chainId ?? "none"}). Switch to chain ${expected}. Wallet writes are blocked.`
        : "Local Arc-compatible demo — chain 5042002 on Anvil. Not Arc Public Testnet."}
    </div>
  );
}
