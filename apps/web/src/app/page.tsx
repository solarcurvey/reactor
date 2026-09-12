"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLaunchTokens } from "@/lib/hooks";
import { formatUnitsSafe } from "@/lib/utils";
import { REVIEW_FIXTURES } from "@/lib/review-fixtures";
import { useReactorStream } from "@/lib/sse";
import { launchPath, quotePath } from "@/lib/untrusted-metadata";
import { SafeTokenImage } from "@/components/safe-media";

const filters = ["Trending", "New", "Bonding", "Rewards", "Buy+Burn", "Batch Fair", "USDC-quoted"] as const;

export default function HomePage() {
  const { data, isLoading, isError, error, refetch } = useLaunchTokens();
  const live = useReactorStream();
  const [filter, setFilter] = useState<(typeof filters)[number]>("New");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    let items = [...(data ?? [])];
    if (filter === "Batch Fair") items = items.filter((t) => t.mode === 1);
    else if (filter === "Bonding") items = items.filter((t) => t.bonding);
    else if (filter === "Rewards") items = items.filter((t) => t.mode === 0 && t.rewardsMode !== false);
    else if (filter === "Buy+Burn") items = items.filter((t) => t.mode === 0 && t.rewardsMode === false);
    else if (filter === "USDC-quoted") items = items.filter((t) => t.quoteSymbol === "USDC");
    else if (filter === "Trending") items = items.filter((t) => t.marketLive);
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.symbol.toLowerCase().includes(needle) ||
        t.token.toLowerCase().includes(needle) ||
        (t.quoteSymbol ?? "").toLowerCase().includes(needle),
    );
  }, [data, filter, q]);

  const vol24 = useMemo(() => {
    return (data ?? []).reduce((acc, t) => {
      const v = t.volume24hUsd6 && t.volume24hUsd6 !== "0" ? BigInt(t.volume24hUsd6) : 0n;
      return acc + v;
    }, 0n);
  }, [data]);

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
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-zinc-300">
              Protocol 0.3.0
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-zinc-300">
              Factory V1
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 tabular-nums text-zinc-300">
              24h vol ${formatUnitsSafe(vol24, 6, 0)}
            </span>
            <span className="rounded-full border border-amber-300/20 bg-amber-300/5 px-2.5 py-1 text-amber-100/80">
              Not audited · no mainnet
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/launch">Choose a quote</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/reactor">THE REACTOR</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/docs">How it works</Link>
          </Button>
        </div>
      </section>

      {(REVIEW_FIXTURES || list.some((t) => t.token.toLowerCase().startsWith("0x11111111"))) && (
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
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / ticker / quote"
            className="h-8 w-44 rounded-full border border-white/10 bg-black/30 px-3 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          <span className="text-[11px] tabular-nums text-zinc-500">
            {list.length} markets · {live.ok ? "live" : "polling"}
          </span>
        </div>
      </div>

      {isLoading && (
        <div className="mt-6 space-y-2" aria-busy="true">
          <p className="text-sm text-zinc-500">Loading indexed markets…</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl bg-white/[0.04]" />
          ))}
        </div>
      )}
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
          <table className="w-full text-left text-[13px]">
            <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Token</th>
                <th className="px-3 py-2 font-medium">Earns</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Mode</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Price</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">24h USD</th>
                <th className="hidden px-3 py-2 font-medium xl:table-cell">FDV</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Holder rewards</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((t, i) => {
                const href = launchPath(t);
                return (
                  <tr key={t.token} className="border-t border-white/6 hover:bg-white/[0.03]">
                    <td className="px-3 py-2 tabular-nums text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Link href={href} className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-white/10 bg-zinc-900 text-[10px] text-cyan-100">
                          <SafeTokenImage src={t.image} className="h-full w-full object-cover" />
                          {!t.image ? t.symbol.slice(0, 2) : null}
                        </span>
                        <span>
                          <span className="font-medium text-white">{t.name}</span>
                          <span className="ml-1.5 font-mono text-[11px] text-zinc-500">${t.symbol}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={quotePath(t.quoteSymbol ?? "x")}
                        className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-100"
                      >
                        {t.rewardsMode === false ? "BUY+BURN" : `EARNS ${t.quoteSymbol ?? "X"}`}
                      </Link>
                    </td>
                    <td className="hidden px-3 py-2 text-zinc-400 sm:table-cell">
                      {t.mode === 1
                        ? t.marketLive
                          ? "Fair · live"
                          : "Fair · auction"
                        : t.bonding
                          ? `${((t.bondingBps ?? 0) / 100).toFixed(0)}% bonded`
                          : "Instant · v4"}
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-[12px] text-zinc-300 md:table-cell">
                      {t.priceQuoteX18 && t.priceQuoteX18 !== "0"
                        ? formatUnitsSafe(BigInt(t.priceQuoteX18), 18, 6)
                        : "—"}
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-[12px] text-zinc-400 lg:table-cell">
                      {t.volume24hUsd6 && t.volume24hUsd6 !== "0"
                        ? `$${formatUnitsSafe(BigInt(t.volume24hUsd6), 6, 0)}`
                        : "—"}
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-[12px] text-zinc-400 xl:table-cell">
                      {t.fdvUsd6 && t.fdvUsd6 !== "0" ? `$${formatUnitsSafe(BigInt(t.fdvUsd6), 6, 0)}` : "—"}
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-[12px] text-zinc-300 md:table-cell">
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
