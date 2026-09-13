import type { Metadata } from "next";
import Link from "next/link";
import { ReactorMark, Wordmark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BRAND, BRAND_AI_DISAMBIGUATION, BRAND_COPY, BRAND_DIRECTION, BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Brand — Industrial Forge",
  description: "Canonical REACTOR brand specimen. Direction C, founder-locked.",
};

const swatches = [
  ["Slag", BRAND.slag],
  ["Steel", BRAND.steel],
  ["Heat", BRAND.heat],
  ["Paper", BRAND.paper],
  ["Muted", BRAND.muted],
  ["Ember", BRAND.ember],
] as const;

export default function BrandSpecimenPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <p className="rx-kicker">
          Direction {BRAND_DIRECTION} · {BRAND_NAME} · Refs #55
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-rx-paper">REACTOR brand system</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-zinc-400">
          {BRAND_COPY.category}. {BRAND_AI_DISAMBIGUATION} Not a messaging network. Founder-locked visual direction.
          Issue #55 stays open until independent audit.{" "}
          <Link href="/docs/brand" className="rx-link">
            Handbook
          </Link>
          .
        </p>
      </header>

      <Card className="flex flex-wrap items-center gap-6 p-5">
        <ReactorMark className="h-20 w-20" />
        <ReactorMark variant="core" className="h-20 w-20" />
        <Wordmark />
        <div className="flex flex-wrap gap-2">
          <Button size="sm">Primary heat</Button>
          <Button size="sm" variant="outline">
            Steel outline
          </Button>
          <Badge>Official pool</Badge>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {swatches.map(([name, hex]) => (
          <div key={hex} className="flex items-center gap-3 rounded-[4px] border border-white/10 p-3">
            <span className="h-8 w-8 rounded-[2px] border border-white/15" style={{ background: hex }} />
            <span>
              <span className="block text-[12px] font-semibold text-rx-paper">{name}</span>
              <span className="font-mono text-[11px] text-rx-muted">{hex}</span>
            </span>
          </div>
        ))}
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="rx-stamp">REACTOR</p>
          <h2 className="mt-1 font-semibold">Launchpad</h2>
          <p className="mt-1 text-[13px] text-zinc-400">Vessel + wordmark. Heat on primary actions only.</p>
        </Card>
        <Card className="p-4">
          <p className="rx-stamp">THE REACTOR</p>
          <h2 className="mt-1 font-semibold">Top-10 plates</h2>
          <p className="mt-1 text-[13px] text-zinc-400">Same family. Stamped ranks. Heat numerals.</p>
        </Card>
        <Card className="p-4">
          <p className="rx-stamp">CORE</p>
          <h2 className="mt-1 font-semibold">Heat-load</h2>
          <p className="mt-1 text-[13px] text-zinc-400">Inner void hex. Never a Top-10 badge.</p>
        </Card>
      </section>

      <p className="text-[12px] text-rx-muted">
        Assets:{" "}
        <a href="/brand/mark.svg" className="rx-link">
          mark
        </a>
        {" · "}
        <a href="/brand/wordmark-dark.svg" className="rx-link">
          wordmark
        </a>
        {" · "}
        <a href="/og/default.png" className="rx-link">
          OG
        </a>
        . Not in primary nav.
      </p>
    </div>
  );
}
