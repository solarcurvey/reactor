"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReactorCore } from "@/components/reactor-core";
import { useCoreStats } from "@/lib/hooks";
import { addresses } from "@/lib/addresses";
import { formatUnitsSafe, shortAddress } from "@/lib/utils";

export default function CorePage() {
  const { data, isLoading, isError } = useCoreStats();

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/8 pb-4">
        <div className="flex items-center gap-4">
          <ReactorCore />
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/90">TESTNET · TestCORE</p>
            <h1 className="text-2xl font-semibold">Fuel and burn</h1>
            <p className="mt-1 max-w-xl text-[13px] text-zinc-400">
              Isolated 0.5% CORE pot. The designated REACTOR Keeper routes quote to CORE through approved adapters and
              burns it. Wallets cannot execute buybacks.
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

      <Card className="mt-4 p-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">Keeper-only</div>
        <p className="mt-1 text-sm text-zinc-300">
          CORE buy+burn is maintenance. The Guardian can pause or replace the Keeper. There is no public bounty and no
          permissionless execute.
        </p>
        {data && data.accruedUsdc < data.threshold && (
          <p className="mt-2 text-[11px] text-zinc-500">Below threshold ({data.threshold.toString()} raw).</p>
        )}
      </Card>
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
