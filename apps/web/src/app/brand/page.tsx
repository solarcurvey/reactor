import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "REACTOR brand directions — not locked",
  description: "Founder direction specimen for issue #55. Not the approved identity.",
};

const directions = [
  {
    id: "A",
    name: "Terminal Core",
    tone: "Terminal",
    mark: "/brand/concepts/a-terminal-core.svg",
    board: "/brand/boards/a-terminal-core.png",
    colors: ["#0B0D10", "#121418", "#7EE8FF", "#F4F7FB"],
    type: "Geist Sans + Geist Mono",
    note: "Closest to the shipped UI. Concentric rings + cyan core.",
  },
  {
    id: "B",
    name: "Market Tape",
    tone: "Market",
    mark: "/brand/concepts/b-market-tape.svg",
    board: "/brand/boards/b-market-tape.png",
    colors: ["#0A0C0B", "#141816", "#E8B86D", "#3DCC8A", "#E85D4C"],
    type: "IBM Plex Sans + Plex Mono (not loaded)",
    note: "Quote-first board. Fits reactor.markets. Ring-R, no glow.",
  },
  {
    id: "C",
    name: "Industrial Forge",
    tone: "Industrial",
    mark: "/brand/concepts/c-industrial-forge.svg",
    board: "/brand/boards/c-industrial-forge.png",
    colors: ["#12110F", "#2A2C2E", "#FF6B2B", "#ECE8E1"],
    type: "Geist heavy / stamped grotesque",
    note: "Forged vessel. Furthest from generic crypto neon.",
  },
] as const;

export default function BrandSpecimenPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <aside className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-[13px] text-amber-50">
        <strong>FOUNDER APPROVAL REQUIRED.</strong> Davis picks <strong>A</strong>, <strong>B</strong>, or{" "}
        <strong>C</strong>. This page is a direction specimen — not a lock. Issue #55 stays open.{" "}
        <Link href="/docs/brand" className="text-cyan-200 underline underline-offset-2">
          Read the proposal
        </Link>
        .
      </aside>

      <header>
        <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">Refs #55 · not locked</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">REACTOR brand directions</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-zinc-400">
          Token launch on Arc — not an AI trading terminal, not a messaging network. Domain note:{" "}
          <code className="text-zinc-200">reactor.markets</code> is available and fits the product. Copy must say
          that on first use.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {directions.map((d) => (
          <article key={d.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              {d.id} · {d.tone}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">{d.name}</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.mark} alt={`${d.name} mark concept`} className="mt-3 aspect-square w-full rounded-xl border border-white/8" />
            <p className="mt-3 text-[13px] leading-5 text-zinc-400">{d.note}</p>
            <p className="mt-2 text-[11px] text-zinc-500">{d.type}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.colors.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <span className="h-3.5 w-3.5 rounded-sm border border-white/15" style={{ background: c }} />
                  {c}
                </span>
              ))}
            </div>
            <a href={d.board} className="mt-3 inline-block text-[12px] text-cyan-200 underline underline-offset-2">
              Mood board
            </a>
            <span className="block text-[10px] text-zinc-600">Raster type on the board is placeholder, not copy.</span>
          </article>
        ))}
      </div>

      <p className="text-[12px] text-zinc-500">
        Concept wordmark (A):{" "}
        <a href="/brand/wordmark-dark.svg" className="text-cyan-200 underline underline-offset-2">
          /brand/wordmark-dark.svg
        </a>
        . Production <code>logo.tsx</code> is unchanged.
      </p>
    </div>
  );
}
