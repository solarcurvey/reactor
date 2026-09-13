"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TradePanel } from "@/components/trade-panel";
import { useLaunchTokens } from "@/lib/hooks";
import { tokenPath } from "@/lib/untrusted-metadata";
import { UntrustedText } from "@/components/untrusted-text";
import { ServiceFailure } from "@/components/service-failure";
import { isServiceUnavailable } from "@/lib/qa-inject";

export default function TradePage() {
  const { data, isLoading, isError, error, refetch } = useLaunchTokens();
  const live = useMemo(() => (data ?? []).filter((t) => t.marketLive), [data]);
  const [sel, setSel] = useState<string>("");
  const token = live.find((t) => t.token === sel) ?? live[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <p className="text-[11px] uppercase tracking-[0.24em] text-rx-cool">Official pool</p>
        <h1 className="mt-1 text-2xl font-semibold">Trade</h1>
        <p className="mt-1 text-[13px] text-zinc-400">
          Exact-in only. 3.5% quote charge: 2% holders / 1% flywheel / 0.5% CORE. Incomplete fills revert.
        </p>
        {isLoading && <p className="mt-6 text-sm text-zinc-400">Loading markets…</p>}
        {isError && (
          <ServiceFailure
            kind={isServiceUnavailable(error) ? error.kind : "indexer"}
            onRetry={() => refetch()}
          />
        )}
        {!isLoading && live.length === 0 && (
          <p className="mt-6 text-sm text-zinc-400">
            No live official pools. <Link href="/launch" className="text-rx-cool underline">Ignite one</Link>.
          </p>
        )}
        <div className="mt-4 divide-y divide-white/6 rounded-[var(--rx-radius-card)] border border-white/8">
          {live.map((t) => (
            <div
              key={t.token}
              className={`flex items-center justify-between px-3 py-2.5 text-sm ${
                token?.token === t.token ? "bg-rx-heat/10" : "hover:bg-white/[0.03]"
              }`}
            >
              <button type="button" onClick={() => setSel(t.token)} className="text-left">
                <UntrustedText field="ticker" className="font-medium text-white">
                  ${t.symbol}
                </UntrustedText>
                <span className="ml-2 text-[11px] text-zinc-400">earns {t.quoteSymbol}</span>
              </button>
              <Link href={tokenPath(t.token)} className="text-[11px] text-rx-cool">
                Detail
              </Link>
            </div>
          ))}
        </div>
      </div>
      <div>{token ? <TradePanel t={token} /> : <p className="text-sm text-zinc-400">Select a live market.</p>}</div>
    </div>
  );
}
