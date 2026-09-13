"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { OhlcvChart } from "@/components/ohlcv-chart";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RewardsModule, TradePanel } from "@/components/trade-panel";
import { useCoreStats, useTokenPage } from "@/lib/hooks";
import { explorerAddress, formatUnitsSafe, shortAddress } from "@/lib/utils";
import { addresses } from "@/lib/addresses";
import { quotePath } from "@/lib/untrusted-metadata";
import { SafeExternalLink } from "@/components/safe-link";
import { UntrustedText } from "@/components/untrusted-text";
import { sanitizeDisplayText } from "@/lib/untrusted-metadata";
import { ServiceFailure } from "@/components/service-failure";
import { isServiceUnavailable } from "@/lib/qa-inject";
import { useQaInject } from "@/components/qa-inject-provider";

const INTERVALS = [
  { id: "1m", sec: 60 },
  { id: "5m", sec: 300 },
  { id: "15m", sec: 900 },
  { id: "1h", sec: 3600 },
  { id: "4h", sec: 14400 },
  { id: "1d", sec: 86400 },
] as const;

export default function TokenPage() {
  const { address } = useParams<{ address: `0x${string}` }>();
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]["id"]>("5m");
  const { data: page, isLoading, isError, error, refetch } = useTokenPage(address, interval);
  const { data: core } = useCoreStats();
  const inject = useQaInject();
  const t = page?.market;
  const tape = page?.swaps;
  const ohlcv = page?.ohlcv;

  if (inject === "token-invalid") {
    return <ServiceFailure kind="token-invalid" />;
  }

  if (isLoading) {
    return (
      <div aria-busy="true">
        <p className="text-sm text-zinc-400">Loading token…</p>
        <div className="mt-4 h-48 animate-pulse rounded-2xl bg-white/[0.04]" />
      </div>
    );
  }
  if (isError) {
    return (
      <ServiceFailure
        kind={isServiceUnavailable(error) ? error.kind : "indexer"}
        onRetry={() => refetch()}
      />
    );
  }
  if (!t) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Token not found</h1>
        <p className="mt-2 text-sm text-zinc-400">This address is not a factory launch on the connected chain.</p>
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
          <UntrustedText as="h1" field="name" className="text-2xl font-semibold">
            {t.name}
          </UntrustedText>
          <UntrustedText field="ticker" className="font-mono text-sm text-zinc-400">
            ${t.symbol}
          </UntrustedText>
          <Link
            href={quotePath(t.quoteSymbol ?? "x")}
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
        <div className="flex flex-wrap gap-3 text-[11px] uppercase tracking-wider">
          <Link href="/docs/fees" className="text-zinc-400 hover:text-cyan-200">
            Fees
          </Link>
          <Link href="/docs/curve" className="text-zinc-400 hover:text-cyan-200">
            Curve
          </Link>
          <Link href="/trade" className="text-zinc-400 hover:text-cyan-200">
            All markets
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
        <div>
        <Card className="h-64 p-2 sm:h-72">
          <div className="flex items-center justify-between px-2 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">
              OHLCV · bonding→v4 · {ohlcv?.sparse ? "sparse" : "continuous"}
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
          {(ohlcv?.candles ?? []).length === 0 ? (
            <div className="grid h-[calc(100%-1.5rem)] place-items-center text-sm text-zinc-400">
              No indexed candles yet. Trades still settle onchain.
            </div>
          ) : (
            <OhlcvChart candles={ohlcv?.candles ?? []} />
          )}
        </Card>
        <Card className="mb-3 p-3" id="tape">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Trade tape · /swaps</div>
          {(tape ?? []).length === 0 ? (
            <p className="mt-2 text-[12px] text-zinc-400">No prints yet. Chart uses candles, not this tape.</p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[12px] font-mono text-zinc-300">
              {[...(tape ?? [])].slice(-24).reverse().map((s, i) => (
                <li key={`${s.t}-${i}`}>
                  <UntrustedText field="activity">
                    {sanitizeDisplayText("source" in s && s.source ? String(s.source) : "trade", 32)}
                  </UntrustedText>{" "}
                  · {formatUnitsSafe(BigInt(s.notional || "0"), t.quoteDecimals ?? 18, 3)}{" "}
                  {t.quoteSymbol}
                  {"px" in s && s.px && s.px !== "0" ? ` · ${formatUnitsSafe(BigInt(s.px), 18, 6)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
        </div>
        <div id="trade">
          {t.bonding && (
            <Card className="mb-3 p-3 text-[13px] text-zinc-300">
              <div className="flex justify-between text-[11px] uppercase tracking-wider text-zinc-400">
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
                <p className="mt-1 text-[11px] text-zinc-400">
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
          <UntrustedText as="p" field="description" clamp className="text-[13px] leading-5 text-zinc-400">
            {t.description || "No description."}
          </UntrustedText>
          {(t.website || t.twitter || t.telegram) && (
            <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
              <SafeExternalLink href={t.website} className="text-cyan-200 underline underline-offset-2">
                Website
              </SafeExternalLink>
              <SafeExternalLink href={t.twitter} className="text-cyan-200 underline underline-offset-2">
                X
              </SafeExternalLink>
              <SafeExternalLink href={t.telegram} className="text-cyan-200 underline underline-offset-2">
                Telegram
              </SafeExternalLink>
            </div>
          )}
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
          <p className="mt-3 text-[11px] text-zinc-400">
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
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      {href ? (
        <a className="font-mono text-cyan-100 underline-offset-2 hover:underline" href={href} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      ) : (
        <div className="font-mono text-zinc-200">{value}</div>
      )}
    </div>
  );
}
