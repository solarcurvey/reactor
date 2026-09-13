"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ServiceFailure } from "@/components/service-failure";
import { SurfaceState, useSurfaceFlags } from "@/components/query-state";
import { TokenCard } from "@/components/token-card";
import { useMarketsInfinite } from "@/lib/hooks";
import type { BoardFilter } from "@/lib/market-ui";
import { isServiceUnavailable } from "@/lib/qa-inject";

const stages = [
  { id: "all" as const, label: "all", board: "New" as BoardFilter, stage: undefined as string | undefined },
  { id: "bonding" as const, label: "bonding", board: "Bonding" as BoardFilter, stage: "bonding" },
  { id: "v4" as const, label: "v4", board: "Trending" as BoardFilter, stage: "v4" },
];

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<(typeof stages)[number]["id"]>("all");
  const deferredQ = useDeferredValue(q);
  const selected = stages.find((s) => s.id === stage) ?? stages[0];

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) setQ(initial);
  }, []);

  const board = useMarketsInfinite({
    q: deferredQ,
    board: selected.board,
    stage: selected.stage,
  });
  const items = useMemo(() => board.data?.pages.flatMap((p) => p.items) ?? [], [board.data]);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && board.hasNextPage && !board.isFetchingNextPage) {
        void board.fetchNextPage();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [board.hasNextPage, board.isFetchingNextPage, board.fetchNextPage]);

  const flags = useSurfaceFlags({
    isLoading: board.isLoading,
    isError: board.isError,
    empty: !board.isLoading && !board.isError && items.length === 0,
    error: board.error,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <p className="rx-kicker">Search</p>
      <h1 className="mt-1 text-2xl font-semibold">Find a market</h1>
      <p className="mt-1 text-[13px] text-zinc-400">
        Global indexer search (`GET /markets?q=`) with cursor pages — not a filter of the first loaded board.{" "}
        <Link href="/docs/traders" className="rx-link">
          Trader docs
        </Link>
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search ticker, name, quote, 0x…"
        aria-label="Search name, ticker, or quote"
        className="mt-4 h-11 w-full rounded-[4px] border border-white/10 bg-black/30 px-4 text-sm outline-none placeholder:text-zinc-400"
        autoFocus
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {stages.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={stage === s.id}
            onClick={() => setStage(s.id)}
            className={`rounded-[2px] px-3 py-1 text-[12px] font-semibold ${
              stage === s.id ? "bg-rx-paper text-rx-slag" : "bg-white/5 text-zinc-400"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {flags.kind === "loading" && <SurfaceState kind="loading" title="Searching the indexer…" testId="markets-loading" />}
      {board.isError && (
        <ServiceFailure
          kind={isServiceUnavailable(board.error) ? board.error.kind : "indexer"}
          onRetry={() => void board.refetch()}
        />
      )}
      {flags.kind === "offline" && !board.isError && (
        <SurfaceState
          kind="offline"
          title={flags.online ? "Indexer unreachable" : "You’re offline"}
          onRetry={() => void board.refetch()}
        />
      )}
      {flags.kind === "empty" && (
        <SurfaceState
          kind="empty"
          testId="markets-empty"
          title="No matches"
          body="Query ran against the full catalog, not the first page."
        />
      )}
      {items.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map((t) => (
            <TokenCard key={t.token} t={t} />
          ))}
        </div>
      )}
      <div ref={moreRef} className="h-8" />
      {board.hasNextPage && (
        <button
          type="button"
          className="mt-2 rounded-[2px] border border-white/10 px-4 py-1.5 text-[12px] text-zinc-300"
          onClick={() => void board.fetchNextPage()}
        >
          {board.isFetchingNextPage ? "Loading more…" : "Load more"}
        </button>
      )}
    </div>
  );
}
