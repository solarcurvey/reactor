"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FeaturedRail } from "@/components/featured-rail";
import { LiveFeed } from "@/components/live-feed";
import { RankedRail } from "@/components/ranked-rail";
import { ServiceFailure } from "@/components/service-failure";
import { SurfaceState, useSurfaceFlags } from "@/components/query-state";
import { TokenCard } from "@/components/token-card";
import { useQaScene } from "@/components/qa-inject-provider";
import { BRAND_COPY } from "@/lib/brand";
import { useCandles, useFeaturedMarkets, useMarketsInfinite } from "@/lib/hooks";
import { formatUsd6Compact, sparkCloses, type BoardFilter } from "@/lib/market-ui";
import { FACTORY_VERSION_LABEL, PROTOCOL_VERSION } from "@/lib/protocol-version";
import { isServiceUnavailable } from "@/lib/qa-inject";
import { FIXTURE_RANKS, REVIEW_FIXTURES } from "@/lib/review-fixtures";
import { useReactorStream } from "@/lib/sse";

const filters: BoardFilter[] = ["Trending", "New", "Bonding", "Rewards", "Buy+Burn", "Batch Fair", "USDC-quoted"];

export default function HomePage() {
  const live = useReactorStream();
  const scene = useQaScene();
  const [filter, setFilter] = useState<BoardFilter>("New");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const board = useMarketsInfinite({ q: deferredQ, board: filter });
  const featured = useFeaturedMarkets();
  const list = useMemo(() => board.data?.pages.flatMap((p) => p.items) ?? [], [board.data]);
  const total = board.data?.pages[0]?.total ?? 0;
  const vol24 = board.data?.pages[0]?.volume24hUsd6Total ?? "0";
  const sparkA = useCandles(featured.data?.bonding?.token, "15m");
  const sparkB = useCandles(featured.data?.volume?.token, "15m");
  const sparks = useMemo(() => {
    const out: Record<string, number[]> = {};
    if (featured.data?.bonding) out[featured.data.bonding.token.toLowerCase()] = sparkCloses(sparkA.data?.candles);
    if (featured.data?.volume) out[featured.data.volume.token.toLowerCase()] = sparkCloses(sparkB.data?.candles);
    return out;
  }, [featured.data, sparkA.data?.candles, sparkB.data?.candles]);

  useEffect(() => {
    if (scene.state === "search") setQ("ZCAT");
    if (scene.state === "filter-bonding") setFilter("Bonding");
  }, [scene.state]);

  const showLoading = board.isLoading || scene.state === "loading";
  const showEmpty =
    !showLoading &&
    !board.isError &&
    (list.length === 0 || scene.state === "empty" || scene.inject === "empty");
  const showCards = list.length > 0 && scene.state !== "loading" && scene.state !== "empty" && scene.inject !== "empty";

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
    isLoading: showLoading,
    isError: board.isError,
    empty: showEmpty,
    error: board.error,
  });

  return (
    <div>
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-white/8 pb-5">
        <div>
          <p className="rx-kicker">{BRAND_COPY.tagline}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Choose what your token earns.
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-zinc-400">
            Official pools: <strong className="text-zinc-200">0% LP</strong> ·{" "}
            <strong className="text-zinc-200">3.5%</strong> quote charge — 2% holders / 1% Top-10 / 0.5% CORE. No
            creator cut. No transfer tax.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-[2px] border border-white/10 bg-white/[0.04] px-2.5 py-1 text-zinc-300">
              Protocol {PROTOCOL_VERSION}
            </span>
            <span className="rounded-[2px] border border-white/10 bg-white/[0.04] px-2.5 py-1 text-zinc-300">
              Factory {FACTORY_VERSION_LABEL}
            </span>
            <span className="rounded-[2px] border border-white/10 bg-white/[0.04] px-2.5 py-1 tabular-nums text-zinc-300">
              24h vol {formatUsd6Compact(vol24)}
            </span>
            <span className="rounded-[2px] border border-rx-warn/30 bg-rx-warn/10 px-2.5 py-1 text-rx-warn">
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

      <FeaturedRail bonding={featured.data?.bonding} volume={featured.data?.volume} sparks={sparks} />
      {REVIEW_FIXTURES && (
        <RankedRail
          rows={FIXTURE_RANKS}
          note="Review fixtures · #1–#10 rail. Distance to #11 is not invented — floor stays $250k. Not a trustless oracle."
        />
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Board filters">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-[2px] px-3 py-1 text-[12px] font-semibold ${
                filter === f ? "bg-rx-paper text-rx-slag" : "bg-white/5 text-zinc-400"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / ticker / quote"
            aria-label="Search name, ticker, or quote"
            className="h-8 w-44 rounded-[2px] border border-white/10 bg-black/30 px-3 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-400"
          />
          <span data-visual-dynamic className="text-[11px] tabular-nums text-zinc-400">
            {total} markets · {live.ok ? "live" : "polling"}
          </span>
          <LiveFeed last={live.last} ok={live.ok} />
        </div>
      </div>

      {showLoading && <SurfaceState kind="loading" title="Loading indexed markets…" testId="markets-loading" />}
      {board.isError && (
        <ServiceFailure
          kind={isServiceUnavailable(board.error) ? board.error.kind : "indexer"}
          detail={board.error instanceof Error ? board.error.message : undefined}
          onRetry={() => void board.refetch()}
        />
      )}
      {flags.kind === "offline" && !board.isError && (
        <SurfaceState
          kind="offline"
          title={flags.online ? "Indexer unreachable" : "You’re offline"}
          body="Discover is indexer-backed (GET /markets + cursor). Reconnect — we will not invent a local catalog."
          onRetry={() => void board.refetch()}
        />
      )}
      {showEmpty && (
        <SurfaceState
          kind="empty"
          testId="markets-empty"
          title={deferredQ ? "No matches" : "No launches yet"}
          body={
            deferredQ
              ? "This search ran on the indexer, not the loaded page. Try another ticker or quote."
              : "Pick a quote and ignite the first official market."
          }
        />
      )}

      {showCards && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <TokenCard key={t.token} t={t} spark={sparks[t.token.toLowerCase()] ?? []} />
          ))}
        </div>
      )}
      <div ref={moreRef} className="h-8" />
      {board.hasNextPage && showCards && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            className="rounded-[2px] border border-white/10 px-4 py-1.5 text-[12px] text-zinc-300"
            onClick={() => void board.fetchNextPage()}
            disabled={board.isFetchingNextPage}
          >
            {board.isFetchingNextPage ? "Loading more…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
