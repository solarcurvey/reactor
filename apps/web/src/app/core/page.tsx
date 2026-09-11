"use client";

import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReactorCore } from "@/components/reactor-core";
import { useCoreStats } from "@/lib/hooks";
import { buyback } from "@/lib/contracts";
import { addresses } from "@/lib/addresses";
import { formatUnitsSafe, shortAddress } from "@/lib/utils";

const SAFETY = ["Ok", "No route", "Cooldown", "Below threshold", "Reserve", "Deviation", "Stale", "Impact"];

export default function CorePage() {
  const { isConnected } = useAccount();
  const client = usePublicClient();
  const { data, refetch, isLoading, isError } = useCoreStats();
  const { writeContractAsync, isPending } = useWriteContract();
  const [msg, setMsg] = useState<string | null>(null);

  async function execute() {
    setMsg(null);
    if (!client) return;
    try {
      const hash = await writeContractAsync({
        ...buyback,
        functionName: "execute",
        args: [addresses.USDC],
      });
      await waitForTransactionReceipt(client, { hash });
      setMsg(`Buyback sent ${hash}`);
      refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Execute failed");
    }
  }

  const reason = data?.preview.reason ?? 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="text-center">
        <ReactorCore />
        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-amber-200/90">TESTNET · TestCORE</p>
        <h1 className="mt-2 text-3xl font-semibold">Fuel and burn</h1>
        <p className="mt-2 text-sm text-zinc-400">
          1% of official-pool quote notional accrues here. Size and minOut are protocol-enforced. Permissionless
          callers cannot set slippage. Failed executes no-op so they never revert a user swap.
        </p>
      </div>
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-zinc-500">Reading vault…</p>}
        {isError && <p className="text-sm text-red-300">Could not read CORE stats from chain.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="CORE supply" value={data ? formatUnitsSafe(data.supply, 18, 2) : "—"} />
          <Stat label="CORE burned" value={data ? formatUnitsSafe(data.lifetimeBurned, 18, 4) : "—"} />
          <Stat label="Pending USDC fuel" value={data ? `${formatUnitsSafe(data.accruedUsdc, 6, 4)} USDC` : "—"} />
          <Stat label="Purchased (lifetime)" value={data ? formatUnitsSafe(data.purchased ?? 0n, 18, 4) : "—"} />
        </div>
        <Card className="space-y-3 p-5">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Safety status</div>
          <p className="text-sm text-zinc-300">{SAFETY[reason] ?? `code ${reason}`}</p>
          <p className="text-xs text-zinc-500">
            Next chunk {data ? formatUnitsSafe(data.preview.amount ?? 0n, 6, 4) : "—"} USDC · approx min CORE{" "}
            {data ? formatUnitsSafe(data.preview.minCoreOut ?? 0n, 18, 4) : "—"}
          </p>
          <Button className="w-full" onClick={execute} disabled={!isConnected || isPending}>
            {isPending ? "Executing…" : "Execute buyback"}
          </Button>
          {data && data.accruedUsdc < data.threshold && (
            <p className="text-xs text-zinc-500">
              Below threshold ({data.threshold.toString()} raw). Accrue more official volume.
            </p>
          )}
          {msg && <p className="break-all text-xs text-zinc-400">{msg}</p>}
        </Card>
        <p className="font-mono text-[11px] text-zinc-600">
          Vault {shortAddress(addresses.BuybackVault)} · CORE {shortAddress(addresses.TestCORE)}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-white">{value}</div>
    </Card>
  );
}
