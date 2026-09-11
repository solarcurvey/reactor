"use client";

import { useParams } from "next/navigation";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RewardsModule, TradePanel } from "@/components/trade-panel";
import { useCoreStats, useSwapSeries, useTokenByAddress } from "@/lib/hooks";
import { explorerAddress, formatUnitsSafe, shortAddress } from "@/lib/utils";
import { addresses } from "@/lib/addresses";

export default function TokenPage() {
  const { address } = useParams<{ address: `0x${string}` }>();
  const { data: t, isLoading } = useTokenByAddress(address);
  const { data: series } = useSwapSeries(address);
  const { data: core } = useCoreStats();

  if (isLoading) return <p className="text-sm text-zinc-500">Loading token…</p>;
  if (!t) return <p className="text-sm text-zinc-500">Token not found on this factory.</p>;

  const chart = (series ?? []).map((s, i) => ({
    i,
    notional: Number(s.notional) / 10 ** (t.quoteDecimals ?? 18),
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold">{t.name}</h1>
              <span className="font-mono text-zinc-500">${t.symbol}</span>
            </div>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">{t.description || "No description."}</p>
          </div>
          {t.marketLive ? <Badge>Official REACTOR Pool</Badge> : <Badge>Auction</Badge>}
        </div>
        <Card className="mt-6 h-64 p-3">
          {chart.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-zinc-500">
              No indexed swaps yet. Trades still settle onchain.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <XAxis dataKey="i" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ background: "#121418", border: "1px solid #222" }}
                  labelFormatter={() => "Quote notional"}
                />
                <Area dataKey="notional" stroke="#7ee8ff" fill="rgba(126,232,255,0.15)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Meta label="Token" value={shortAddress(t.token)} href={explorerAddress(t.token)} />
          <Meta label="Quote" value={`${t.quoteSymbol} ${shortAddress(t.quote)}`} href={explorerAddress(t.quote)} />
          <Meta label="Pool ID" value={shortAddress(t.poolId, 6)} />
          <Meta label="Creator" value={shortAddress(t.creator)} />
          <Meta label="Supply" value={formatUnitsSafe(t.supply, t.decimals, 0)} />
          <Meta
            label="Lifetime holder rewards"
            value={`${formatUnitsSafe(t.lifetimeRewards ?? 0n, t.quoteDecimals ?? 18, 4)} ${t.quoteSymbol}`}
          />
        </div>
        <Card className="mt-4 p-4 text-sm text-zinc-400">
          Protocol economics attach to the official market, not the token. External pools are allowed and uncharged.
          CORE burned (global): {core ? formatUnitsSafe(core.lifetimeBurned, 18, 4) : "—"} CORE
        </Card>
      </div>
      <div className="space-y-4">
        <TradePanel t={t} />
        <RewardsModule t={t} />
        <Card className="p-4 text-xs text-zinc-500">
          LP locked at {shortAddress(addresses.ReactorLiquidityVault)}. No creator withdraw.
        </Card>
      </div>
    </div>
  );
}

function Meta({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      {href ? (
        <a className="font-mono text-cyan-100 underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <div className="font-mono text-zinc-200">{value}</div>
      )}
    </div>
  );
}
