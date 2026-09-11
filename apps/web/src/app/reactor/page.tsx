"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useReactorEvents } from "@/lib/hooks";
import { FIXTURE_RANKS, REVIEW_FIXTURES } from "@/lib/review-fixtures";
import { shortAddress } from "@/lib/utils";

export default function ReactorPage() {
  const { data, isLoading, isError } = useReactorEvents();
  const events = data?.events ?? [];
  const ranks = REVIEW_FIXTURES ? FIXTURE_RANKS : [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/8 pb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/80">THE REACTOR</p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Top-10 flywheel</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-zinc-400">
            1% of official quote volume, settled to USDC, then buy+burn on ranked names. TWAP mcap floor $250k.
            Instant starting FDV is not a rank. CORE is never eligible. If fewer than ten qualify, they split the
            full pot. If zero qualify, the pot accumulates.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/core">CORE 0.5%</Link>
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <Stat label="Split" value="1.00%" sub="of quote notional" />
        <Stat label="Epoch" value="5 min" sub="keeper finalize" />
        <Stat label="Floor" value="$250k" sub="TWAP mcap" />
        <Stat label="Bounty" value="0.10 USDC" sub="isolated reserve" />
      </div>

      <div className="mt-5 overflow-x-auto rounded-2xl border border-white/8">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Rank</th>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 font-medium">Quote</th>
              <th className="px-3 py-2 font-medium">TWAP mcap</th>
              <th className="px-3 py-2 font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {ranks.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-sm text-zinc-500">
                  No ranked names yet — need two TWAP samples in the last epoch and a USDC-safe path. Distance to #11
                  appears once an eleventh qualifier exists. #11 receives zero.
                </td>
              </tr>
            )}
            {ranks.map((r) => (
              <tr key={r.token} className="border-t border-white/6">
                <td className="px-3 py-2 tabular-nums text-cyan-100">#{r.rank}</td>
                <td className="px-3 py-2 font-medium text-white">${r.symbol}</td>
                <td className="px-3 py-2 text-zinc-400">{r.quote}</td>
                <td className="px-3 py-2 font-mono text-zinc-200">{r.mcap}</td>
                <td className="px-3 py-2 text-zinc-400">{r.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {REVIEW_FIXTURES && ranks.length > 0 && (
        <p className="mt-2 text-[11px] text-zinc-500">
          Review board — distance to #11 not shown (fewer than 11 qualifiers). Fixture ranks are not live TWAP.
        </p>
      )}

      <Card className="mt-5 p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Indexer feed</div>
        {isLoading && <p className="mt-2 text-sm text-zinc-500">Reading /reactor…</p>}
        {isError && <p className="mt-2 text-sm text-zinc-500">Indexer offline — events still settle onchain.</p>}
        {!isLoading && events.length === 0 && (
          <p className="mt-2 text-sm text-zinc-500">
            No FlywheelAccrued / EpochFinalized / Top10Buy / COREBurned logs yet.
          </p>
        )}
        <ul className="mt-3 space-y-1.5 font-mono text-[11px] text-zinc-400">
          {events.slice(0, 12).map((e, i) => (
            <li key={`${e.tx}-${i}`} className="flex justify-between gap-3">
              <span>
                {e.name}
                {e.token ? ` · ${shortAddress(e.token)}` : ""}
              </span>
              <span className="text-zinc-600">#{e.block}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-white">{value}</div>
      <div className="text-[11px] text-zinc-500">{sub}</div>
    </Card>
  );
}
