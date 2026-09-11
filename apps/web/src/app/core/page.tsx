"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, parseAbi } from "viem";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReactorCore } from "@/components/reactor-core";
import { useCoreStats } from "@/lib/hooks";
import { addresses, deployment } from "@/lib/addresses";
import { arcLocal } from "@/lib/chain";
import { formatUnitsSafe, shortAddress } from "@/lib/utils";

const BENEFICIARY = "0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406" as const;

const vestingAbi = parseAbi([
  "function t0() view returns (uint64)",
  "function claimed() view returns (uint256)",
  "function vested() view returns (uint256)",
  "function claimable() view returns (uint256)",
  "function TOTAL() view returns (uint256)",
  "function BENEFICIARY() view returns (address)",
]);

export default function CorePage() {
  const { data, isLoading, isError } = useCoreStats();
  const vesting = useQuery({
    queryKey: ["core-vesting", addresses.CoreVesting],
    enabled: !!addresses.CoreVesting,
    queryFn: async () => {
      const client = createPublicClient({ chain: arcLocal, transport: http(deployment.rpc) });
      const addr = addresses.CoreVesting as `0x${string}`;
      const [t0, claimed, vested, claimable, total] = await Promise.all([
        client.readContract({ address: addr, abi: vestingAbi, functionName: "t0" }),
        client.readContract({ address: addr, abi: vestingAbi, functionName: "claimed" }),
        client.readContract({ address: addr, abi: vestingAbi, functionName: "vested" }),
        client.readContract({ address: addr, abi: vestingAbi, functionName: "claimable" }),
        client.readContract({ address: addr, abi: vestingAbi, functionName: "TOTAL" }),
      ]);
      return { t0, claimed, vested, claimable, total };
    },
    refetchInterval: 30_000,
  });

  const t0 = vesting.data ? Number(vesting.data.t0) : 0;
  const t0Label = t0 === 0 ? "Not activated (pre-launch)" : new Date(t0 * 1000).toISOString().slice(0, 10);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/8 pb-4">
        <div className="flex items-center gap-4">
          <ReactorCore />
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/90">GENESIS · not Instant</p>
            <h1 className="text-2xl font-semibold">CORE</h1>
            <p className="mt-1 max-w-xl text-[13px] text-zinc-400">
              Permanent official CORE/USDC pool from genesis — no bonding, no graduation, never Top-10. 1B minted once:
              100M vest / 900M locked LP. External CORE/USDC trades: 2.5% buy+burn + 1% flywheel.
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/reactor">THE REACTOR 1%</Link>
        </Button>
      </div>

      {isLoading && <p className="mt-4 text-sm text-zinc-500">Reading CORE…</p>}
      {isError && <p className="mt-4 text-sm text-red-300">Could not read CORE stats from chain.</p>}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total supply" value={data ? formatUnitsSafe(data.supply, 18, 2) : "—"} sub="burns reduce this" />
        <Stat label="Burned" value={data ? formatUnitsSafe(data.lifetimeBurned, 18, 4) : "—"} sub="real burn()" />
        <Stat label="Buy+burn USDC" value={data ? formatUnitsSafe(data.accruedUsdc, 6, 4) : "—"} sub="0.5% others · 2.5% CORE book" />
        <Stat label="Start FDV" value="$100k" sub="~$0.0001 / CORE" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Vesting · 100M</div>
          <p className="mt-1 text-[13px] text-zinc-400">
            Beneficiary {shortAddress(BENEFICIARY)}. T0 is public launch, not deploy. 30-day cliff with{" "}
            <strong className="text-zinc-200">zero</strong> unlock at day 30, then 10 months linear. No admin.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <Meta k="T0" v={t0Label} />
            <Meta k="Vested" v={vesting.data ? formatUnitsSafe(vesting.data.vested, 18, 2) : "—"} />
            <Meta k="Claimed" v={vesting.data ? formatUnitsSafe(vesting.data.claimed, 18, 2) : "—"} />
            <Meta k="Claimable" v={vesting.data ? formatUnitsSafe(vesting.data.claimable, 18, 2) : "—"} />
          </div>
          {vesting.isError && <p className="mt-2 text-[12px] text-zinc-500">Vesting contract not on this deployment yet.</p>}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Official market · 900M locked</div>
          <p className="mt-1 text-[13px] text-zinc-400">
            Single-sided CORE/USDC at genesis. Permanent lock — nobody withdraws LP. Not a bonding curve and not a
            graduated Instant name. CORE does not enter the Top-10 race.
          </p>
          <p className="mt-3 text-[12px] text-zinc-500">
            Maintenance buy+burn is Keeper-only through CoreBuybackExecutor (fee-exempt). Wallets pay 3.5%.
          </p>
        </Card>
      </div>

      <p className="mt-4 font-mono text-[11px] text-zinc-600">
        CORE {shortAddress(addresses.CoreToken ?? addresses.TestCORE)} · Vesting {shortAddress(addresses.CoreVesting ?? "0x")} · Vault{" "}
        {shortAddress(addresses.BuybackVault)}
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-white">{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </Card>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</div>
      <div className="font-mono text-zinc-200">{v}</div>
    </div>
  );
}
