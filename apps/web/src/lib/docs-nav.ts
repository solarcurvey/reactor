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

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
