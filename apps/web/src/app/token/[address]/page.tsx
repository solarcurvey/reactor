"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RewardsModule, TradePanel } from "@/components/trade-panel";
import { useCoreStats, useSwapSeries, useTokenByAddress } from "@/lib/hooks";
import { explorerAddress, formatUnitsSafe, priceFromSqrtX96, shortAddress } from "@/lib/utils";
import { addresses } from "@/lib/addresses";

const INTERVALS = [
  { id: "1m", sec: 60 },
  { id: "5m", sec: 300 },
  { id: "1h", sec: 3600 },
  { id: "4h", sec: 14400 },
  { id: "1d", sec: 86400 },
] as const;

export default function TokenPage() {
  const { address } = useParams<{ address: `0x${string}` }>();
  const { data: t, isLoading } = useTokenByAddress(address);
  const { data: series } = useSwapSeries(address);
  const { data: core } = useCoreStats();
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]["id"]>("5m");
  const sec = INTERVALS.find((x) => x.id === interval)?.sec ?? 300;
  const chart = useMemo(() => {
    if (!t) return [];
    const tokenIs0 = t.token.toLowerCase() < t.quote.toLowerCase();
    const pts: { t: number; price: number }[] = [];
    for (const s of series ?? []) {
      const ts = Number(s.ts ?? s.t ?? 0);
      let price = 0;
      if (s.sqrtPrice && s.sqrtPrice !== "0") {
        price = priceFromSqrtX96(BigInt(s.sqrtPrice), tokenIs0, t.decimals, t.quoteDecimals ?? 18);
      } else if (s.px && s.px !== "0") {
        price = Number(s.px) / 1e18;
      }
      if (!(price > 0) || !(ts > 0)) continue;
      const bucket = Math.floor(ts / sec) * sec;
      const last = pts[pts.length - 1];
      if (!last || last.t !== bucket) pts.push({ t: bucket, price });
      else last.price = price;
    }
    return pts;
  }, [series, t, sec]);

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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{t.name}</h1>
          <span className="font-mono text-sm text-zinc-500">${t.symbol}</span>
          <Link
            href={`/quote/${t.quoteSymbol ?? "x"}`}
            className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-100"
          >
            {t.rewardsMode === false ? "BUY+BURN" : `EARNS ${t.quoteSymbol}`}
          </Link>
          {t.marketLive ? (
            <Badge>Official v4</Badge>
          ) : t.bonding ? (
            <Badge className="border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
              {((t.bondingBps ?? 0) / 100).toFixed(1)}% bonded
            </Badge>
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
          <div className="flex items-center justify-between px-2 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              PRICE · bonding→v4 · chain time
            </span>
            <div className="flex gap-1">
              {INTERVALS.map((x) => (
                <button
                  key={x.id}
                  onClick={() => setInterval(x.id)}
                  className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                    interval === x.id ? "bg-white text-zinc-950" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {x.id}
                </button>
              ))}
            </div>
          </div>
          {chart.length === 0 ? (
            <div className="grid h-[calc(100%-1.5rem)] place-items-center text-sm text-zinc-500">
              No indexed swaps yet. Trades still settle onchain.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="90%">
              <AreaChart data={chart}>
                <XAxis dataKey="t" hide />
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
          {t.bonding && (
            <Card className="mb-3 p-3 text-[13px] text-zinc-300">
              <div className="flex justify-between text-[11px] uppercase tracking-wider text-zinc-500">
                <span>Bonding</span>
                <span>{((t.bondingBps ?? 0) / 100).toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-cyan-300" style={{ width: `${Math.min(100, (t.bondingBps ?? 0) / 100)}%` }} />
              </div>
              <p className="mt-2 text-zinc-400">
                {formatUnitsSafe(t.realQuote ?? 0n, t.quoteDecimals ?? 18, 2)} /{" "}
                {formatUnitsSafe(t.gradTarget ?? 0n, t.quoteDecimals ?? 18, 2)} {t.quoteSymbol} to graduate · leftover
                inventory locks on the curve. Chart continues on v4 after graduation.
              </p>
              {t.devBought && t.devBought > 0n ? (
                <p className="mt-1 text-[11px] text-zinc-500">
                  Creator initial buy: {formatUnitsSafe(t.devBought, t.decimals, 2)} {t.symbol} (disclosed forever)
                </p>
              ) : null}
            </Card>
          )}
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
