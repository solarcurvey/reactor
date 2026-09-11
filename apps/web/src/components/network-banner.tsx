"use client";

import { useAccount } from "wagmi";
import { deployment } from "@/lib/addresses";
import { arcLocal } from "@/lib/chain";

export function NetworkBanner() {
  const { chainId, isConnected } = useAccount();
  if (deployment.claimedArcTestnet) return null;
  const wrong = isConnected && chainId !== arcLocal.id;
  return (
    <div
      className={`border-b px-4 py-2 text-center text-[12px] ${
        wrong
          ? "border-red-500/30 bg-red-500/10 text-red-100"
          : "border-cyan-300/15 bg-cyan-300/8 text-cyan-100"
      }`}
    >
      {wrong
        ? `Wrong network (${chainId ?? "none"}). Switch to chain ${arcLocal.id}.`
        : "Local Arc-compatible demo — chain 5042002 on Anvil. Not Arc Public Testnet."}
    </div>
  );
}
