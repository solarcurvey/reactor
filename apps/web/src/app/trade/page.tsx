"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TradePanel } from "@/components/trade-panel";
import { useLaunchTokens } from "@/lib/hooks";
import { tokenPath } from "@/lib/untrusted-metadata";
import { UntrustedText } from "@/components/untrusted-text";

export default function TradePage() {
  const { data, isLoading, isError } = useLaunchTokens();
  const live = useMemo(() => (data ?? []).filter((t) => t.marketLive), [data]);
  const [sel, setSel] = useState<string>("");
  const token = live.find((t) => t.token === sel) ?? live[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/80">Official pool</p>
        <h1 className="mt-1 text-2xl font-semibold">Trade</h1>
        <p className="mt-1 text-[13px] text-zinc-400">
          Exact-in only. 3.5% quote charge: 2% holders / 1% flywheel / 0.5% CORE. Incomplete fills revert.
        </p>
        {isLoading && <p className="mt-6 text-sm text-zinc-500">Loading markets…</p>}
        {isError && <p className="mt-6 text-sm text-zinc-500">Factory unreachable.</p>}
        {!isLoading && live.length === 0 && (
          <p className="mt-6 text-sm text-zinc-500">
            No live official pools. <Link href="/launch" className="text-cyan-200 underline">Ignite one</Link>.
          </p>
        )}
        <div className="mt-4 divide-y divide-white/6 rounded-2xl border border-white/8">
          {live.map((t) => (
            <button
              key={t.token}
              onClick={() => setSel(t.token)}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm ${
                token?.token === t.token ? "bg-cyan-300/10" : "hover:bg-white/[0.03]"
              }`}
            >
              <span>
                <UntrustedText field="ticker" className="font-medium text-white">
                  ${t.symbol}
                </UntrustedText>
                <span className="ml-2 text-[11px] text-zinc-500">earns {t.quoteSymbol}</span>
              </span>
              <Link href={tokenPath(t.token)} className="text-[11px] text-cyan-200" onClick={(e) => e.stopPropagation()}>
                Detail
              </Link>
            </button>
          ))}
        </div>
      </div>
      <div>{token ? <TradePanel t={token} /> : <p className="text-sm text-zinc-500">Select a live market.</p>}</div>
    </div>
  );
}
