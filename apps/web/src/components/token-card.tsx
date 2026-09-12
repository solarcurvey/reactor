import Link from "next/link";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { LaunchToken } from "@/lib/hooks";
import { formatUnitsSafe } from "@/lib/utils";
import { launchPath } from "@/lib/untrusted-metadata";
import { SafeTokenImage } from "./safe-media";
import { UntrustedText } from "./untrusted-text";

export function TokenCard({ t }: { t: LaunchToken }) {
  return (
    <Link href={launchPath(t)}>
      <Card className="group p-4 transition hover:border-cyan-300/30 hover:bg-white/[0.04]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-white/10 bg-zinc-900 text-xs text-cyan-100">
              <SafeTokenImage src={t.image} className="h-full w-full object-cover" />
              {!t.image ? t.symbol.slice(0, 2) : null}
            </div>
            <div>
              <UntrustedText field="name" className="font-medium text-white">
                {t.name}
              </UntrustedText>
              <UntrustedText field="ticker" className="block font-mono text-xs text-zinc-400">
                ${t.symbol}
              </UntrustedText>
            </div>
          </div>
          {t.marketLive ? (
            <Badge>Official pool</Badge>
          ) : (
            <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-100">Batch Fair</Badge>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[11px] uppercase tracking-wider text-cyan-100">
            Earns {t.quoteSymbol ?? "quote"}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">
            2% of official volume → holders in {t.quoteSymbol ?? "quote"}
          </span>
        </div>
        <UntrustedText as="p" field="description" clamp className="mt-3 text-sm text-zinc-400">
          {t.description || "No description."}
        </UntrustedText>
        <div className="mt-4 flex justify-between text-[11px] uppercase tracking-wider text-zinc-500">
          <span>TEST ASSET quote</span>
          <span>
            Lifetime {formatUnitsSafe(t.lifetimeRewards ?? 0n, t.quoteDecimals ?? 18, 3)} {t.quoteSymbol}
          </span>
        </div>
      </Card>
    </Link>
  );
}
