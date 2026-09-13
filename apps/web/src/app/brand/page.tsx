import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "REACTOR brand — Industrial Forge",
  description: "Founder-locked Direction C. Issue #55 stays open until production surfaces and #36 baselines match.",
};

const tokens = [
  ["Slag", "#12110F"],
  ["Steel", "#2A2C2E"],
  ["Heat", "#FF6B2B"],
  ["Paper", "#ECE8E1"],
  ["Cool", "#9AA4AD"],
] as const;

export default function BrandSpecimenPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <aside className="rounded-[var(--rx-radius-card)] border border-rx-warn/40 bg-rx-warn/10 px-4 py-3 text-[13px] text-rx-paper">
        <strong>FOUNDER-LOCKED: Direction C — Industrial Forge.</strong> Davis approved C on 2026-09-13. Issue #55
        stays open until production surfaces, launch assets, and #36 visual baselines match.{" "}
        <Link href="/docs/brand" className="text-rx-cool underline underline-offset-2 hover:text-rx-paper">
          Brand handbook
        </Link>
        .
      </aside>

      <header>
        <p className="text-[11px] uppercase tracking-[0.14em] text-rx-cool">Refs #55 · locked C</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-rx-paper">Industrial Forge</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-rx-cool">
          Token launch on Arc — not an AI trading terminal. Heat on primary actions only. Steel stamps everywhere else.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <figure className="rounded-[var(--rx-radius-card)] border border-rx-steel p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.svg" alt="REACTOR mark" className="mx-auto h-40 w-40" />
          <figcaption className="mt-3 text-center text-[12px] text-rx-cool">Canonical mark</figcaption>
        </figure>
        <figure className="rounded-[var(--rx-radius-card)] border border-rx-steel p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark-dark.svg" alt="REACTOR wordmark" className="w-full" />
          <figcaption className="mt-3 text-center text-[12px] text-rx-cool">Wordmark + differentiator</figcaption>
        </figure>
      </div>

      <div className="flex flex-wrap gap-3">
        {tokens.map(([name, hex]) => (
          <span key={hex} className="inline-flex items-center gap-2 text-[12px] text-rx-cool">
            <span className="h-5 w-5 rounded-[var(--rx-radius-chip)] border border-rx-steel" style={{ background: hex }} />
            {name} {hex}
          </span>
        ))}
      </div>
    </div>
  );
}
