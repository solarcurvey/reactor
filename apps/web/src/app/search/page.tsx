"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLaunchTokens } from "@/lib/hooks";
import { formatUnitsSafe } from "@/lib/utils";
import { tokenPath } from "@/lib/untrusted-metadata";
import { UntrustedText } from "@/components/untrusted-text";
import { ServiceFailure } from "@/components/service-failure";
import { isServiceUnavailable } from "@/lib/qa-inject";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [stage, setStage] = useState<"all" | "bonding" | "v4">("all");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, isError, error, refetch } = useLaunchTokens({
    q: debounced,
    stage: stage === "all" ? undefined : stage,
    limit: 80,
  });
  const items = data ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-[11px] uppercase tracking-[0.22em] text-rx-cool">Search</p>
      <h1 className="mt-1 text-2xl font-semibold">Find a market</h1>
      <p className="mt-1 text-[13px] text-zinc-400">
        SQL-backed indexer search by name, ticker, quote, or address.{" "}
        <Link href="/docs/traders" className="text-rx-cool underline">
          Trader docs
        </Link>
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search ticker, name, quote, 0x…"
        className="mt-4 h-11 w-full rounded-[var(--rx-radius-card)] border border-white/10 bg-black/30 px-4 text-sm outline-none"
        autoFocus
      />
      <div className="mt-3 flex gap-2">
        {(["all", "bonding", "v4"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={stage === s}
            onClick={() => setStage(s)}
            className={`rounded-[var(--rx-radius-chip)] px-3 py-1 text-[12px] ${stage === s ? "bg-white text-zinc-950" : "bg-white/5 text-zinc-400"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {isLoading && <p className="mt-6 text-sm text-zinc-400">Loading markets…</p>}
      {isError && (
        <ServiceFailure
          kind={isServiceUnavailable(error) ? error.kind : "indexer"}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && items.length === 0 && <p className="mt-6 text-sm text-zinc-400">No matches.</p>}
      <ul className="mt-4 divide-y divide-white/8 rounded-[var(--rx-radius-card)] border border-white/8">
        {items.map((t) => (
          <li key={t.token}>
            <Link href={tokenPath(t.token)} className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.03]">
              <span>
                <UntrustedText field="name" className="font-medium">
                  {t.name}
                </UntrustedText>
                <UntrustedText field="ticker" className="ml-2 font-mono text-[12px] text-zinc-400">
                  ${t.symbol}
                </UntrustedText>
              </span>
              <span className="text-[11px] uppercase tracking-wider text-rx-paper">
                {t.rewardsMode === false ? "BUY+BURN" : `EARNS ${t.quoteSymbol}`}
                {t.priceQuoteX18 && t.priceQuoteX18 !== "0"
                  ? ` · ${formatUnitsSafe(BigInt(t.priceQuoteX18), 18, 6)}`
                  : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
