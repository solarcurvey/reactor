"use client";

import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { useState } from "react";
import Link from "next/link";
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
        functionName: "executeCoreBuyback",
        args: [addresses.USDC],
      });
      await waitForTransactionReceipt(client, { hash });
      setMsg(`Buyback sent ${hash}`);
      refetch();
    } catch {
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
  }

  const reason = data?.preview.reason ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/8 pb-4">
        <div className="flex items-center gap-4">
          <ReactorCore />
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/90">TESTNET · TestCORE</p>
            <h1 className="text-2xl font-semibold">Fuel and burn</h1>
            <p className="mt-1 max-w-xl text-[13px] text-zinc-400">
              Isolated 0.5% CORE pot. Size and minOut are protocol-enforced. Failed executes no-op.
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/reactor">THE REACTOR 1%</Link>
        </Button>
      </div>

      {isLoading && <p className="mt-4 text-sm text-zinc-500">Reading vault…</p>}
      {isError && <p className="mt-4 text-sm text-red-300">Could not read CORE stats from chain.</p>}

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <Stat label="CORE supply" value={data ? formatUnitsSafe(data.supply, 18, 2) : "—"} />
        <Stat label="CORE burned" value={data ? formatUnitsSafe(data.lifetimeBurned, 18, 4) : "—"} />
        <Stat label="Pending USDC" value={data ? `${formatUnitsSafe(data.accruedUsdc, 6, 4)}` : "—"} />
        <Stat label="Purchased" value={data ? formatUnitsSafe(data.purchased ?? 0n, 18, 4) : "—"} />
      </div>

      <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Safety</div>
          <p className="text-sm text-zinc-200">{SAFETY[reason] ?? `code ${reason}`}</p>
          <p className="text-[11px] text-zinc-500">
            Next chunk {data ? formatUnitsSafe(data.preview.amount ?? 0n, 6, 4) : "—"} USDC · min CORE{" "}
            {data ? formatUnitsSafe(data.preview.minCoreOut ?? 0n, 18, 4) : "—"}
          </p>
        </div>
        <Button onClick={execute} disabled={!isConnected || isPending}>
          {isPending ? "Executing…" : "Execute CORE buyback"}
        </Button>
      </Card>
      {data && data.accruedUsdc < data.threshold && (
        <p className="mt-2 text-[11px] text-zinc-500">Below threshold ({data.threshold.toString()} raw).</p>
      )}
      {msg && <p className="mt-2 break-all text-[11px] text-zinc-400">{msg}</p>}
      <p className="mt-4 font-mono text-[11px] text-zinc-600">
        Vault {shortAddress(addresses.BuybackVault)} · CORE {shortAddress(addresses.TestCORE)}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-white">{value}</div>
    </Card>
  );
}
