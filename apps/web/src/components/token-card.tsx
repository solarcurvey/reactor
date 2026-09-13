import Link from "next/link";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { LaunchToken } from "@/lib/hooks";
import {
  bondingPct,
  change24hTone,
  earnsLabel,
  formatChange24h,
  formatUsd6Compact,
  isReadyFrozen,
  marketHref,
  primaryActionLabel,
  stageLabel,
} from "@/lib/market-ui";
import { Sparkline } from "./sparkline";
import { SafeTokenImage } from "./safe-media";
import { UntrustedText } from "./untrusted-text";
import { sanitizeTicker, sanitizeTokenName } from "@/lib/untrusted-metadata";

export function TokenCard({ t, spark = [] }: { t: LaunchToken; spark?: number[] }) {
  const href = marketHref(t);
  const frozen = isReadyFrozen(t);
  const tone = change24hTone(t.change24hBps);
  return (
    <Link href={href} className="block h-full">
      <Card className="group flex h-full flex-col p-3.5 transition hover:border-rx-heat/30 hover:bg-white/[0.04]">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rx-avatar h-10 w-10 shrink-0 text-[11px]">
              <SafeTokenImage src={t.image} className="h-full w-full object-cover" />
              {!t.image ? (sanitizeTicker(t.symbol) || "TK").slice(0, 2) : null}
            </div>
            <div className="min-w-0">
              <UntrustedText field="name" className="block truncate font-medium text-white">
                {sanitizeTokenName(t.name)}
              </UntrustedText>
              <UntrustedText field="ticker" className="block font-mono text-[11px] text-zinc-400">
                ${sanitizeTicker(t.symbol) || "TKN"}
              </UntrustedText>
            </div>
          </div>
          <div className="text-right">
            <div
              className={`font-mono text-[12px] tabular-nums ${
                tone === "up" ? "text-rx-up" : tone === "down" ? "text-rx-down" : "text-zinc-400"
              }`}
            >
              {formatChange24h(t.change24hBps)}
            </div>
            <Sparkline points={spark} />
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="rx-chip">{earnsLabel(t)}</span>
          {frozen ? (
            <Badge className="border-rx-warn/30 bg-rx-warn/10 text-rx-warn">Frozen</Badge>
          ) : t.marketLive ? (
            <Badge>v4</Badge>
          ) : t.bonding ? (
            <Badge className="border-rx-heat/30 bg-rx-heat/10 text-rx-ember">{stageLabel(t)}</Badge>
          ) : t.mode === 1 ? (
            <Badge className="border-rx-warn/30 bg-rx-warn/10 text-rx-warn">Batch Fair</Badge>
          ) : null}
        </div>

        {t.bonding && !t.marketLive && (
          <div className="mt-2.5">
            <div className="h-1 overflow-hidden rounded-[2px] bg-white/10">
              <div className="h-full bg-rx-heat" style={{ width: `${bondingPct(t)}%` }} />
            </div>
          </div>
        )}

        <dl className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
          <div>
            <dt className="uppercase tracking-wider text-zinc-400">FDV</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-zinc-200">{formatUsd6Compact(t.fdvUsd6)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider text-zinc-400">Liq</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-zinc-200">{formatUsd6Compact(t.liquidityUsd6)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider text-zinc-400">24h vol</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-zinc-200">{formatUsd6Compact(t.volume24hUsd6)}</dd>
          </div>
          <div className="text-right">
            <dt className="uppercase tracking-wider text-zinc-400">Action</dt>
            <dd className="mt-0.5 text-[11px] uppercase tracking-wider text-rx-ember">{primaryActionLabel(t)}</dd>
          </div>
        </dl>
      </Card>
    </Link>
  );
}
