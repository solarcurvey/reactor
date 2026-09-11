"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TokenCard } from "@/components/token-card";
import { ReactorMark } from "@/components/logo";
import { useLaunchTokens } from "@/lib/hooks";

const filters = ["Trending", "New", "Fair", "Top Rewards", "Most Burned"] as const;

export default function HomePage() {
  const { data, isLoading, isError, error, refetch } = useLaunchTokens();
  const [filter, setFilter] = useState<(typeof filters)[number]>("New");

  const list = useMemo(() => {
    const items = [...(data ?? [])];
    if (filter === "Fair") return items.filter((t) => t.mode === 1);
    if (filter === "Top Rewards") return items.sort((a, b) => Number((b.lifetimeRewards ?? 0n) - (a.lifetimeRewards ?? 0n)));
    if (filter === "Most Burned") return items.filter((t) => t.quoteSymbol === "USDC");
    if (filter === "Trending") return items.filter((t) => t.marketLive);
    return items;
  }, [data, filter]);

  return (
    <div>
      <section className="relative overflow-hidden rounded-3xl border border-white/8 bg-[rgba(14,16,20,0.85)] px-6 py-10 sm:px-10">
        <div className="pointer-events-none absolute -right-8 -top-10 opacity-40">
          <ReactorMark className="h-56 w-56" spin />
        </div>
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Launch. Reflect. Burn.</p>
        <h1 className="mt-3 max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Launch markets that pay holders.
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-zinc-400">
          Official REACTOR pools are Uniswap v4 markets with a 0% LP fee and a 3% quote-side protocol charge — 2% to
          holders, 1% to CORE buyback-and-burn. No token tax. No creator cut.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/launch">Ignite token</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/core">CORE dashboard</Link>
          </Button>
        </div>
      </section>

      <div className="mt-8 flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm ${
              filter === f ? "bg-white text-zinc-950" : "bg-white/5 text-zinc-400"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading && <p className="mt-10 text-sm text-zinc-500">Reading launches from chain…</p>}
      {isError && (
        <div className="mt-10 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          Could not read the factory. Is Anvil running on 127.0.0.1:8545?
          <div className="mt-2 text-xs text-red-200/80">{error instanceof Error ? error.message : "RPC error"}</div>
          <button className="mt-3 underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}
      {!isLoading && !isError && list.length === 0 && (
        <p className="mt-10 text-sm text-zinc-500">No launches yet. Ignite the first official market.</p>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => (
          <TokenCard key={t.token} t={t} />
        ))}
      </div>
    </div>
  );
}
