"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RewardsModule, TradePanel } from "@/components/trade-panel";
import { useCoreStats, useSwapSeries, useTokenByAddress } from "@/lib/hooks";
import { explorerAddress, formatUnitsSafe, priceFromSqrtX96, shortAddress } from "@/lib/utils";
import { addresses } from "@/lib/addresses";

export default function TokenPage() {
  const { address } = useParams<{ address: `0x${string}` }>();
  const { data: t, isLoading } = useTokenByAddress(address);
  const { data: series } = useSwapSeries(address);
  const { data: core } = useCoreStats();

  if (isLoading) return <p className="text-sm text-zinc-500">Loading token…</p>;
  if (!t) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Token not found</h1>
        <p className="mt-2 text-sm text-zinc-500">This address is not a factory launch on the connected chain.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-cyan-200 underline">
          Back to the board
        </Link>
      </div>
    );
  }

  const tokenIs0 = t.token.toLowerCase() < t.quote.toLowerCase();
  const chart = (series ?? []).map((s, i) => {
    const sqrt = s.sqrtPrice ? BigInt(s.sqrtPrice) : 0n;
    return {
      i,
      price: priceFromSqrtX96(sqrt, tokenIs0, t.decimals, t.quoteDecimals ?? 18),
    };
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{t.name}</h1>
          <span className="font-mono text-sm text-zinc-500">${t.symbol}</span>
          <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-100">
            Earns {t.quoteSymbol}
          </span>
          {t.marketLive ? (
            <Badge>Official pool</Badge>
          ) : t.mode === 1 ? (
            <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-100">Batch Fair</Badge>
          ) : null}
        </div>
        <Link href={`/trade`} className="text-[11px] uppercase tracking-wider text-zinc-500 hover:text-cyan-200">
          All markets
        </Link>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
        <Card className="h-64 p-2 sm:h-72">
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
                  labelFormatter={() => `Price (${t.quoteSymbol} per ${t.symbol})`}
                />
                <Area dataKey="price" stroke="#7ee8ff" fill="rgba(126,232,255,0.15)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
        <div id="trade">
          <TradePanel t={t} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.35fr_0.85fr]">
        <div>
          <p className="text-[13px] leading-5 text-zinc-400">{t.description || "No description."}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3">
            <Meta label="Token" value={shortAddress(t.token)} href={explorerAddress(t.token)} />
            <Meta label="Quote" value={`${t.quoteSymbol} ${shortAddress(t.quote)}`} href={explorerAddress(t.quote)} />
            <Meta label="Pool" value={shortAddress(t.poolId, 6)} />
            <Meta label="Creator" value={shortAddress(t.creator)} />
            <Meta label="Supply" value={formatUnitsSafe(t.supply, t.decimals, 0)} />
            <Meta
              label="Lifetime holders"
              value={`${formatUnitsSafe(t.lifetimeRewards ?? 0n, t.quoteDecimals ?? 18, 4)} ${t.quoteSymbol}`}
            />
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">
            Economics attach to the official market, not the token. CORE burned (global):{" "}
            {core ? formatUnitsSafe(core.lifetimeBurned, 18, 4) : "—"} · LP {shortAddress(addresses.ReactorLiquidityVault)}
          </p>
        </div>
        <RewardsModule t={t} />
      </div>
    </div>
  );
}

function Meta({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
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
