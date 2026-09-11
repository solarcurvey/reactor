"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLaunchTokens } from "@/lib/hooks";
import { formatUnitsSafe } from "@/lib/utils";
import { REVIEW_FIXTURES } from "@/lib/review-fixtures";

const filters = ["Trending", "New", "Batch Fair", "Top Rewards", "USDC-quoted"] as const;

export default function HomePage() {
  const { data, isLoading, isError, error, refetch } = useLaunchTokens();
  const [filter, setFilter] = useState<(typeof filters)[number]>("New");

  const list = useMemo(() => {
    const items = [...(data ?? [])];
    if (filter === "Batch Fair") return items.filter((t) => t.mode === 1);
    if (filter === "Top Rewards") return items.sort((a, b) => Number((b.lifetimeRewards ?? 0n) - (a.lifetimeRewards ?? 0n)));
    if (filter === "USDC-quoted") return items.filter((t) => t.quoteSymbol === "USDC");
    if (filter === "Trending") return items.filter((t) => t.marketLive);
    return items;
  }, [data, filter]);

  return (
    <div>
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-white/8 pb-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/80">Launch. Reflect. Burn.</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Choose what your token earns.
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-zinc-400">
            Official pools: <strong className="text-zinc-200">0% LP</strong> ·{" "}
            <strong className="text-zinc-200">3.5%</strong> quote charge — 2% holders / 1% Top-10 / 0.5% CORE. No
            creator cut. No transfer tax.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/launch">Choose a quote</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/reactor">THE REACTOR</Link>
          </Button>
        </div>
      </section>

      {REVIEW_FIXTURES && (
        <p className="mt-3 text-[11px] uppercase tracking-wider text-amber-200/80">Review fixtures — not on-chain</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-[12px] ${
                filter === f ? "bg-white text-zinc-950" : "bg-white/5 text-zinc-400"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="text-[11px] tabular-nums text-zinc-500">{list.length} markets</span>
      </div>

      {isLoading && <p className="mt-8 text-sm text-zinc-500">Reading launches from chain…</p>}
      {isError && !REVIEW_FIXTURES && (
        <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          Could not read the factory. Is Anvil running on 127.0.0.1:8545?
          <div className="mt-2 text-xs text-red-200/80">{error instanceof Error ? error.message : "RPC error"}</div>
          <button className="mt-3 underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}
      {!isLoading && !isError && list.length === 0 && (
        <p className="mt-8 text-sm text-zinc-500">No launches yet. Pick a quote and ignite the first official market.</p>
      )}

      {list.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/8">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Token</th>
                <th className="px-3 py-2 font-medium">Earns</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Supply</th>
                <th className="px-3 py-2 font-medium">Holder rewards</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((t, i) => {
                const href = t.mode === 1 && !t.marketLive ? `/fair/${t.fairId}` : `/token/${t.token}`;
                return (
                  <tr key={t.token} className="border-t border-white/6 hover:bg-white/[0.03]">
                    <td className="px-3 py-2 tabular-nums text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Link href={href} className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-zinc-900 text-[10px] text-cyan-100">
                          {t.symbol.slice(0, 2)}
                        </span>
                        <span>
                          <span className="font-medium text-white">{t.name}</span>
                          <span className="ml-1.5 font-mono text-[11px] text-zinc-500">${t.symbol}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-100">
                        {t.quoteSymbol ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{t.mode === 1 ? (t.marketLive ? "Fair · live" : "Fair · auction") : "Instant"}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-zinc-300">{formatUnitsSafe(t.supply, t.decimals, 0)}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-zinc-300">
                      {formatUnitsSafe(t.lifetimeRewards ?? 0n, t.quoteDecimals ?? 18, 3)} {t.quoteSymbol}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={href} className="text-[11px] uppercase tracking-wider text-cyan-200 hover:underline">
                        {t.mode === 1 && !t.marketLive ? "Auction" : "Trade"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
