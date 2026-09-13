"use client";

import { useMemo, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { SurfaceState, useSurfaceFlags } from "@/components/query-state";
import { TokenCard } from "@/components/token-card";
import { useMarketsInfinite, useQuotes } from "@/lib/hooks";
import { formatUnitsSafe } from "@/lib/utils";

/**
 * Quote-ecosystem metrics (no double-count):
 * - Markets = launches whose quote token matches this symbol (indexer `quote_symbol`).
 * - Holder rewards in X = sum of token.lifetimeRewards only (the 2% bucket).
 *   Flywheel 1% and CORE 0.5% are NOT added here — they are other pots.
 * - Bonding / graduated are partitions of Instant markets, not extra volume.
 */
export default function QuotePage() {
  const { symbol } = useParams<{ symbol: string }>();
  const { data: quotes, isLoading: quotesLoading, isError: quotesError, refetch: refetchQuotes } = useQuotes();
  const sym = decodeURIComponent(symbol ?? "").toUpperCase();
  const quote = quotes?.find((q) => q.symbol.toUpperCase() === sym);
  const board = useMarketsInfinite({ quoteSymbol: sym.toLowerCase(), enabled: Boolean(sym) });
  const markets = useMemo(() => board.data?.pages.flatMap((p) => p.items) ?? [], [board.data]);
  const holderRewards = markets.reduce((s, t) => s + (t.lifetimeRewards ?? 0n), 0n);
  const bonding = markets.filter((t) => t.bonding).length;
  const graduated = markets.filter((t) => t.mode === 0 && t.marketLive).length;
  const rewardsN = markets.filter((t) => t.rewardsMode !== false && t.mode === 0).length;
  const burnN = markets.filter((t) => t.rewardsMode === false && t.mode === 0).length;
  const dec = quote?.decimals ?? markets[0]?.quoteDecimals ?? 18;
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
    isLoading: board.isLoading || quotesLoading,
    isError: board.isError || quotesError,
    empty: !board.isLoading && !board.isError && markets.length === 0,
    error: board.error,
  });

  return (
    <div>
      <p className="rx-kicker">{sym} ON REACTOR</p>
      <h1 className="mt-1 text-2xl font-semibold">{sym} ecosystem</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
        Markets priced in {sym}. Holder-reward total is the conserved 2% bucket only — we do not add Top-10 or CORE
        (that would triple-count the 3.5%). Instant starts on a bonding curve; ungraduated names are not Top-10
        eligible. Catalog is `GET /markets?quote_symbol=` with cursor pages.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Markets" v={String(board.data?.pages[0]?.total ?? markets.length)} />
        <Stat k={`Holder rewards in ${sym}`} v={`${formatUnitsSafe(holderRewards, dec, 3)} ${sym}`} />
        <Stat k="Bonding / graduated" v={`${bonding} / ${graduated}`} />
        <Stat k="Rewards / Buy+Burn" v={`${rewardsN} / ${burnN}`} />
      </div>

      {flags.kind === "loading" && <SurfaceState kind="loading" title={`Reading ${sym} markets…`} />}
      {flags.kind === "offline" && (
        <SurfaceState
          kind="offline"
          title={flags.online ? "Indexer unreachable" : "You’re offline"}
          onRetry={() => {
            void board.refetch();
            void refetchQuotes();
          }}
        />
      )}
      {flags.kind === "error" && !flags.offline && (
        <SurfaceState kind="error" title={`${sym} ecosystem failed`} onRetry={() => void board.refetch()} />
      )}
      {flags.kind === "empty" && (
        <SurfaceState
          kind="empty"
          testId="quote-empty"
          title={`No launches quoted in ${sym}`}
          body="This list is indexer-filtered by quote symbol, not a client slice of Discover."
        />
      )}

      {markets.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {markets.map((t) => (
            <TokenCard key={t.token} t={t} />
          ))}
        </div>
      )}
      <div ref={moreRef} className="h-8" />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</div>
      <div className="mt-1 text-lg font-medium text-white">{v}</div>
    </Card>
  );
}
