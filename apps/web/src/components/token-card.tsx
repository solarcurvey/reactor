import Link from "next/link";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import type { LaunchToken } from "@/lib/hooks";
import { formatUnitsSafe } from "@/lib/utils";

export function TokenCard({ t }: { t: LaunchToken }) {
  return (
    <Link href={t.mode === 1 && !t.marketLive ? `/fair/${t.fairId}` : `/token/${t.token}`}>
      <Card className="group p-4 transition hover:border-cyan-300/30 hover:bg-white/[0.04]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-white/10 bg-zinc-900 text-xs text-cyan-100">
              {t.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.image} alt="" className="h-full w-full object-cover" />
              ) : (
                t.symbol.slice(0, 2)
              )}
            </div>
            <div>
              <div className="font-medium text-white">{t.name}</div>
              <div className="font-mono text-xs text-zinc-400">${t.symbol}</div>
            </div>
          </div>
          {t.marketLive ? (
            <Badge>Official pool</Badge>
          ) : (
            <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-100">Fair auction</Badge>
          )}
        </div>
        <p className="mt-3 line-clamp-2 text-sm text-zinc-400">
          {t.description || "No description."}
        </p>
        <div className="mt-4 flex justify-between text-[11px] uppercase tracking-wider text-zinc-500">
          <span>Quote {t.quoteSymbol ?? "—"}</span>
          <span>
            Rewards {formatUnitsSafe(t.lifetimeRewards ?? 0n, t.quoteDecimals ?? 18, 3)} {t.quoteSymbol}
          </span>
        </div>
      </Card>
    </Link>
  );
}
