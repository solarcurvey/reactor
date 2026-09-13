import Link from "next/link";
import { sanitizeTicker } from "@/lib/untrusted-metadata";
import { Card } from "./ui/card";
import { UntrustedText } from "./untrusted-text";

export type RankedRailRow = {
  rank: number;
  symbol: string;
  token: string;
  mcap: string;
  quote: string;
};

export function RankedRail({ rows, note }: { rows: RankedRailRow[]; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <Card className="mt-4 min-w-0 overflow-hidden p-3" aria-label="Top-10 ranked rail">
      <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 text-[11px] uppercase tracking-[0.18em] text-zinc-400">#1–#10 · THE REACTOR</h2>
        <Link href="/reactor" className="rx-link shrink-0 text-[11px]">
          Full board
        </Link>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <ol className="flex w-max gap-2">
          {rows.slice(0, 10).map((r) => (
            <li key={r.token}>
              <Link
                href={`/token/${r.token}`}
                className="block min-w-[7.5rem] rounded-[4px] border border-white/8 bg-black/20 px-2.5 py-2 hover:border-rx-heat/30"
              >
                <div className="text-[10px] font-semibold text-rx-heat">#{r.rank}</div>
                <UntrustedText field="ticker" className="block font-medium text-white">
                  ${sanitizeTicker(r.symbol) || "TKN"}
                </UntrustedText>
                <div className="font-mono text-[11px] text-zinc-400">{r.mcap}</div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                  EARNS {sanitizeTicker(r.quote) || "QUOTE"}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-2 min-w-0 text-[11px] text-zinc-400">
        {note ??
          "Offchain API ranks. Distance to #11 is the gap under #10 down to the $250k floor — not a trustless oracle."}
      </p>
    </Card>
  );
}
