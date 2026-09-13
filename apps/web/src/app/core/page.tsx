"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, parseAbi } from "viem";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SurfaceState, useSurfaceFlags } from "@/components/query-state";
import { ReactorCore } from "@/components/reactor-core";
import { useCoreStats } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { readContractsBatched } from "@/lib/rpc-batch";
import { addresses } from "@/lib/addresses";
import { arcLocal } from "@/lib/chain";
import { formatUnitsSafe, shortAddress } from "@/lib/utils";
import { ServiceFailure } from "@/components/service-failure";
import { isServiceUnavailable } from "@/lib/qa-inject";

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
  const { data, isLoading, isError, error, refetch } = useCoreStats();
  const vesting = useQuery({
    queryKey: qk.coreVesting(addresses.CoreVesting),
    enabled: !!addresses.CoreVesting,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const client = createPublicClient({
        chain: arcLocal,
        transport: http(arcLocal.rpcUrls.default.http[0]),
      });
      const addr = addresses.CoreVesting as `0x${string}`;
      const [t0, claimed, vested, claimable, total] = await readContractsBatched<bigint>(client, [
        { address: addr, abi: vestingAbi, functionName: "t0" },
        { address: addr, abi: vestingAbi, functionName: "claimed" },
        { address: addr, abi: vestingAbi, functionName: "vested" },
        { address: addr, abi: vestingAbi, functionName: "claimable" },
        { address: addr, abi: vestingAbi, functionName: "TOTAL" },
      ]);
      return { t0, claimed, vested, claimable, total };
    },
    refetchInterval: 30_000,
  });

  const t0 = vesting.data ? Number(vesting.data.t0) : 0;
  const t0Label = t0 === 0 ? "Not activated (pre-launch)" : new Date(t0 * 1000).toISOString().slice(0, 10);
  const flags = useSurfaceFlags({
    isLoading,
    isError,
    empty: !isLoading && !isError && !data,
    error,
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/8 pb-4">
        <div className="flex items-center gap-4">
          <ReactorCore />
          <div>
            <p className="rx-kicker">GENESIS · not Instant</p>
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

      {flags.kind === "loading" && <SurfaceState kind="loading" title="Reading CORE…" />}
      {isError && (
        <ServiceFailure
          kind={isServiceUnavailable(error) ? error.kind : "rpc"}
          detail={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      )}
      {flags.kind === "offline" && !isError && (
        <SurfaceState
          kind="offline"
          title={flags.online ? "Chain / indexer unreachable" : "You’re offline"}
          body="CORE genesis numbers are onchain. This dashboard will not invent supply, vest, or burn."
          onRetry={() => void refetch()}
        />
      )}
      {flags.kind === "empty" && (
        <SurfaceState
          kind="empty"
          title="CORE is not on this deployment yet"
          body="Genesis 100M vest + 900M locked official CORE/USDC. Never Top-10."
        />
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total supply" value={data ? formatUnitsSafe(data.supply, 18, 2) : "—"} sub="burns reduce this" />
        <Stat label="Burned" value={data ? formatUnitsSafe(data.lifetimeBurned, 18, 4) : "—"} sub="real burn()" />
        <Stat label="Buy+burn USDC" value={data ? formatUnitsSafe(data.accruedUsdc, 6, 4) : "—"} sub="0.5% others · 2.5% CORE book" />
        <Stat label="Start FDV" value="$100k" sub="~$0.0001 / CORE" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Vesting · 100M</div>
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
          {vesting.isError && <p className="mt-2 text-[12px] text-zinc-400">Vesting contract not on this deployment yet.</p>}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Official market · 900M locked</div>
          <p className="mt-1 text-[13px] text-zinc-400">
            Single-sided CORE/USDC at genesis. Permanent lock — nobody withdraws LP. Not a bonding curve and not a
            graduated Instant name. CORE does not enter the Top-10 race.
          </p>
          <p className="mt-3 text-[12px] text-zinc-400">
            Maintenance buy+burn is Keeper-only through CoreBuybackExecutor (fee-exempt). Wallets pay 3.5%.
          </p>
        </Card>
      </div>

      <p className="mt-4 font-mono text-[11px] text-zinc-400">
        CORE {shortAddress(addresses.CoreToken ?? addresses.TestCORE)} · Vesting {shortAddress(addresses.CoreVesting ?? "0x")} · Vault{" "}
        {shortAddress(addresses.BuybackVault)}
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-white">{value}</div>
      {sub && <div className="text-[11px] text-zinc-400">{sub}</div>}
    </Card>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</div>
      <div className="font-mono text-zinc-200">{v}</div>
    </div>
  );
}
