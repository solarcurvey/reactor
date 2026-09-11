"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TokenCard } from "@/components/token-card";
import { ReactorMark } from "@/components/logo";
import { Card } from "@/components/ui/card";
import { useLaunchTokens } from "@/lib/hooks";

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
      <section className="relative overflow-hidden rounded-3xl border border-white/8 bg-[rgba(14,16,20,0.85)] px-6 py-10 sm:px-10">
        <div className="pointer-events-none absolute -right-8 -top-10 opacity-40">
          <ReactorMark className="h-56 w-56" spin />
        </div>
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Launch. Reflect. Burn.</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Choose what your token earns.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400">
          Official REACTOR pools are Uniswap v4 markets with a <strong className="text-zinc-200">0% LP fee</strong> and a{" "}
          <strong className="text-zinc-200">3% quote-side protocol charge</strong> — 2% to holders in the quote you pick,
          1% to TestCORE buyback-and-burn. No creator cut. No platform cash tax. No transfer tax.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/launch">Choose a quote</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/core">CORE dashboard</Link>
          </Button>
        </div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <EconCard title="$1,000 official trade" body="$20 to holders in the quote · $10 to CORE fuel. The 3% is REACTOR, not an LP fee." />
        <EconCard title="2% holders / 1% CORE / 0% LP" body="Holders are paid the quote asset. CORE is burned on a safety-gated route. LP fee stays 0%." />
        <EconCard title="Local / testnet only" body="Numbers come from chain. This UI does not claim Arc Public Testnet or mainnet." />
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
        <p className="mt-10 text-sm text-zinc-500">No launches yet. Pick a quote and ignite the first official market.</p>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => (
          <TokenCard key={t.token} t={t} />
        ))}
      </div>
    </div>
  );
}

function EconCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium text-white">{title}</div>
      <p className="mt-1 text-xs leading-5 text-zinc-400">{body}</p>
    </Card>
  );
}
