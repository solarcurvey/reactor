"use client";

import { useAccount } from "wagmi";
import { WalletButton } from "@/components/wallet-button";
import { Card } from "@/components/ui/card";
import { shortAddress } from "@/lib/utils";

export default function WalletPage() {
  const { address, isConnected, chainId } = useAccount();
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold">Wallet</h1>
      <p className="mt-1 text-[13px] text-zinc-400">
        Local Arc-compatible chain only. This UI does not claim Arc Public Testnet.
      </p>
      <Card className="mt-4 space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-zinc-400">Status</span>
          <span className="text-sm text-white">{isConnected ? "Connected" : "Disconnected"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-zinc-400">Address</span>
          <span className="font-mono text-sm">{isConnected ? shortAddress(address) : "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-zinc-400">Chain</span>
          <span className="font-mono text-sm">{isConnected ? String(chainId ?? "—") : "—"}</span>
        </div>
        <WalletButton />
      </Card>
    </div>
  );
}
