"use client";

import { useAccount } from "wagmi";
import { Card } from "@/components/ui/card";
import { formatUnitsSafe, shortAddress } from "@/lib/utils";
import { REVIEW_FIXTURES } from "@/lib/review-fixtures";
import { useWalletSnapshot } from "@/lib/hooks";

export default function WalletPage() {
  const { address, isConnected, chainId } = useAccount();
  const { data: snap } = useWalletSnapshot(address);
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
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-zinc-400">USDC</span>
          <span className="font-mono text-sm">{snap ? formatUnitsSafe(snap.usdc, 6, 2) : "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-zinc-400">CORE</span>
          <span className="font-mono text-sm">{snap ? formatUnitsSafe(snap.core, 18, 2) : "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-zinc-400">USDC allowance (router)</span>
          <span className="font-mono text-sm">{snap ? formatUnitsSafe(snap.usdcAllowance, 6, 2) : "—"}</span>
        </div>
      </Card>
      {REVIEW_FIXTURES && (
        <Card className="mt-3 space-y-2 p-4">
          <div className="text-[11px] uppercase tracking-wider text-amber-200/80">Review · connected sample</div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-zinc-400">Address</span>
            <span className="font-mono">0x7099…79C8</span>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-zinc-400">Chain</span>
            <span className="font-mono">5042002 · local</span>
          </div>
        </Card>
      )}
    </div>
  );
}
