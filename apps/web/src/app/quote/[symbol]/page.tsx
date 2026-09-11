"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { useLaunchTokens, useQuotes } from "@/lib/hooks";
import { formatUnitsSafe } from "@/lib/utils";

/**
 * Quote-ecosystem metrics (no double-count):
 * - Markets = launches whose quote token matches this symbol.
 * - Holder rewards in X = sum of token.lifetimeRewards only (the 2% bucket).
 *   Flywheel 1% and CORE 0.5% are NOT added here — they are other pots.
 * - Bonding / graduated are partitions of Instant markets, not extra volume.
 */
export default function QuotePage() {
  const { symbol } = useParams<{ symbol: string }>();
  const { data: tokens, isLoading } = useLaunchTokens();
  const { data: quotes } = useQuotes();
  const sym = decodeURIComponent(symbol ?? "").toUpperCase();
  const quote = quotes?.find((q) => q.symbol.toUpperCase() === sym);
  const markets = (tokens ?? []).filter((t) => (t.quoteSymbol ?? "").toUpperCase() === sym);
  const holderRewards = markets.reduce((s, t) => s + (t.lifetimeRewards ?? 0n), 0n);
  const bonding = markets.filter((t) => t.bonding).length;
  const graduated = markets.filter((t) => t.mode === 0 && t.marketLive).length;
  const rewardsN = markets.filter((t) => t.rewardsMode !== false && t.mode === 0).length;
  const burnN = markets.filter((t) => t.rewardsMode === false && t.mode === 0).length;
  const dec = quote?.decimals ?? markets[0]?.quoteDecimals ?? 18;

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">{sym} ON REACTOR</p>
      <h1 className="mt-1 text-2xl font-semibold">{sym} ecosystem</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
        Markets priced in {sym}. Holder-reward total is the conserved 2% bucket only — we do not add Top-10 or CORE
        (that would triple-count the 3.5%). Instant starts on a bonding curve; ungraduated names are not Top-10
        eligible.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Markets" v={String(markets.length)} />
        <Stat k={`Holder rewards in ${sym}`} v={`${formatUnitsSafe(holderRewards, dec, 3)} ${sym}`} />
        <Stat k="Bonding / graduated" v={`${bonding} / ${graduated}`} />
        <Stat k="Rewards / Buy+Burn" v={`${rewardsN} / ${burnN}`} />
      </div>

      {isLoading && <p className="mt-6 text-sm text-zinc-500">Reading markets…</p>}
      {!isLoading && markets.length === 0 && (
        <p className="mt-6 text-sm text-zinc-500">No launches quoted in {sym} yet.</p>
      )}

      <div className="mt-6 space-y-2">
        {markets.map((t) => (
          <Link key={t.token} href={`/token/${t.token}`}>
            <Card className="flex items-center justify-between p-3 hover:border-cyan-300/30">
              <div>
                <div className="font-medium text-white">
                  {t.name} <span className="font-mono text-xs text-zinc-500">${t.symbol}</span>
                </div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-500">
                  {t.rewardsMode === false ? "BUY+BURN" : `EARNS ${sym}`}
                  {t.bonding ? ` · ${((t.bondingBps ?? 0) / 100).toFixed(0)}% bonded` : t.marketLive ? " · v4" : ""}
                </div>
              </div>
              <div className="font-mono text-[12px] text-zinc-300">
                {formatUnitsSafe(t.lifetimeRewards ?? 0n, dec, 3)} {sym}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</div>
      <div className="mt-1 text-lg font-medium text-white">{v}</div>
    </Card>
  );
}
