"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useReactorEvents } from "@/lib/hooks";
import { ServiceFailure } from "@/components/service-failure";
import { FIXTURE_RANKS, REVIEW_FIXTURES } from "@/lib/review-fixtures";
import { isServiceUnavailable } from "@/lib/qa-inject";
import { shortAddress } from "@/lib/utils";
import { sanitizeDisplayText, sanitizeTicker } from "@/lib/untrusted-metadata";
import { UntrustedText } from "@/components/untrusted-text";

type ApiRank = {
  rank: number;
  token: string;
  symbol: string;
  quote: string;
  markUsdc: string;
  weightBps: number;
};

type ApiPayload = {
  source: string;
  pauseEpoch: boolean;
  reason: string;
  rows: ApiRank[];
  trust: string;
};

export default function ReactorPage() {
  const { data, isLoading, isError, error, refetch } = useReactorEvents();
  const events = data?.events ?? [];
  const api = useQuery({
    queryKey: qk.top10,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<ApiPayload> => {
      const res = await fetch("/api/reactor/top10", { signal });
      if (!res.ok) throw new Error("api");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const ranks = REVIEW_FIXTURES
    ? FIXTURE_RANKS
    : (api.data?.rows ?? []).map((r) => ({
        rank: r.rank,
        token: r.token,
        symbol: r.symbol,
        quote: r.quote || "—",
        mcap: formatMark(r.markUsdc),
        weight: `${(r.weightBps / 100).toFixed(2)}%`,
      }));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/8 pb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-rx-cool">THE REACTOR</p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Top-10 flywheel</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-zinc-400">
            1% of official quote volume, settled to USDC by the designated REACTOR Keeper, then buy+burn on API-ranked
            names. Operational floor ~$250k. CORE is never eligible. Ranks are computed offchain — this is not a
            trustless oracle.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/core">CORE 0.5%</Link>
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <Stat label="Split" value="1.00%" sub="of quote notional" />
        <Stat label="Refresh" value="~5 min" sub="REACTOR API" />
        <Stat label="Floor" value="$250k" sub="operational mark" />
        <Stat label="Publisher" value="Keeper" sub="structural onchain checks" />
      </div>

      {api.data?.pauseEpoch && (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-100">
          Epoch paused — a mark was unreliable. The API will not guess. Keeper should skip this epoch.
        </p>
      )}
      {api.data && !api.data.pauseEpoch && (
        <p className="mt-4 text-[12px] text-zinc-400">{api.data.reason}</p>
      )}

      <div className="mt-5 overflow-x-auto rounded-[var(--rx-radius-card)] border border-white/8">
        <table className="w-full min-w-[640px] text-left text-[13px]" aria-label="Top-10 API ranks">
          <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Rank</th>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 font-medium">Quote</th>
              <th className="px-3 py-2 font-medium">API mark</th>
              <th className="px-3 py-2 font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {ranks.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-sm text-zinc-400">
                  No API ranks yet. Graduated names need a defensible mark at or above $250k. Ungraduated Instant and
                  CORE never qualify. Onchain epoch members come from Keeper-submitted events, not from this table
                  alone.
                </td>
              </tr>
            )}
            {ranks.map((r) => (
              <tr key={r.token} className="border-t border-white/6">
                <td className="px-3 py-2 tabular-nums text-rx-paper">#{r.rank}</td>
                <td className="px-3 py-2 font-medium text-white">
                  <UntrustedText field="ticker">${sanitizeTicker(r.symbol) || "TKN"}</UntrustedText>
                </td>
                <td className="px-3 py-2 text-zinc-400">{r.quote}</td>
                <td className="px-3 py-2 font-mono text-zinc-200">{r.mcap}</td>
                <td className="px-3 py-2 text-zinc-400">{r.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-zinc-400">
        {REVIEW_FIXTURES
          ? "Review board fixtures. Not live API marks."
          : api.data?.trust ??
            "API ranks plus onchain EpochSubmitted / Top10Buy events. Route and minOut are operational Keeper risk."}
      </p>

      <Card className="mt-5 p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Onchain epoch events</div>
        {isLoading && <p className="mt-2 text-sm text-zinc-400">Reading /reactor…</p>}
        {isError && (
          <ServiceFailure
            kind={isServiceUnavailable(error) ? error.kind : "indexer"}
            onRetry={() => refetch()}
          />
        )}
        {!isLoading && events.length === 0 && (
          <p className="mt-2 text-sm text-zinc-400">
            No FlywheelAccrued / EpochSubmitted / Top10Buy / COREBurned logs yet.
          </p>
        )}
        <ul className="mt-3 space-y-1.5 font-mono text-[11px] text-zinc-400">
          {events.slice(0, 12).map((e, i) => (
            <li key={`${e.tx}-${i}`} className="flex justify-between gap-3">
              <span>
                <UntrustedText field="activity">
                  {sanitizeDisplayText(e.name, 48)}
                  {e.token ? ` · ${shortAddress(e.token)}` : ""}
                </UntrustedText>
              </span>
              <span className="text-zinc-400">#{e.block}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function formatMark(raw: string) {
  try {
    const n = Number(raw) / 1e6;
    if (!Number.isFinite(n)) return raw;
    return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${n.toLocaleString()}`;
  } catch {
    return raw;
  }
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-white">{value}</div>
      <div className="text-[11px] text-zinc-400">{sub}</div>
    </Card>
  );
}
