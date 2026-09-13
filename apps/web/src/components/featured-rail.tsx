import type { LaunchToken } from "@/lib/hooks";
import { TokenCard } from "./token-card";

export function FeaturedRail({
  bonding,
  volume,
  sparks,
}: {
  bonding?: LaunchToken | null;
  volume?: LaunchToken | null;
  items?: LaunchToken[];
  sparks?: Record<string, number[]>;
}) {
  const cards = [bonding, volume].filter((t): t is LaunchToken => Boolean(t));
  if (cards.length === 0) return null;
  return (
    <section className="mt-4" aria-label="Featured markets">
      <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Featured</h2>
        <p className="min-w-0 text-[11px] text-zinc-400">Closest to graduation · highest 24h USD</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((t) => (
          <TokenCard key={t.token} t={t} spark={sparks?.[t.token.toLowerCase()] ?? []} />
        ))}
      </div>
    </section>
  );
}
