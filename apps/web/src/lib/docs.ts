import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DOCS: { slug: string; title: string; group: string; file: string }[] = [
  { slug: "", title: "How REACTOR works", group: "Start", file: "index.md" },
  { slug: "traders", title: "Traders", group: "Audience", file: "traders.md" },
  { slug: "creators", title: "Creators", group: "Audience", file: "creators.md" },
  { slug: "builders", title: "Builders", group: "Audience", file: "builders.md" },
  { slug: "curve", title: "Curve math", group: "Protocol", file: "curve.md" },
  { slug: "fees", title: "Nested fees", group: "Protocol", file: "fees.md" },
  { slug: "top-10", title: "Top-10", group: "Protocol", file: "top-10.md" },
  { slug: "core", title: "CORE", group: "Protocol", file: "core.md" },
  { slug: "tickers", title: "Ticker registry", group: "Launch", file: "tickers.md" },
  { slug: "guardian", title: "Guardian", group: "Launch", file: "guardian.md" },
  { slug: "api", title: "API", group: "Builders", file: "api.md" },
  { slug: "sdk", title: "SDK", group: "Builders", file: "sdk.md" },
  { slug: "events", title: "Events", group: "Builders", file: "events.md" },
  { slug: "deployments", title: "Deployments", group: "Builders", file: "deployments.md" },
  { slug: "faq", title: "FAQ", group: "Reference", file: "faq.md" },
  { slug: "glossary", title: "Glossary", group: "Reference", file: "glossary.md" },
];

export function docsRoot(): string {
  return join(process.cwd(), "..", "..", "docs");
}

export function loadDoc(slug: string): { title: string; markdown: string } | null {
  const meta = DOCS.find((d) => d.slug === slug);
  if (!meta) return null;
  const p = join(docsRoot(), meta.file);
  if (!existsSync(p)) return null;
  return { title: meta.title, markdown: readFileSync(p, "utf8") };
}

export function headings(md: string): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  for (const line of md.split("\n")) {
    const m = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/[`*]/g, "");
    out.push({ id: slugify(text), text, level: m[1]!.length });
  }
  return out;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
