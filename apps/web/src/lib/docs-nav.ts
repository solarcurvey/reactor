export const DOCS: { slug: string; title: string; group: string; file: string }[] = [
  { slug: "", title: "How REACTOR works", group: "Start", file: "index.md" },
  { slug: "traders", title: "Traders", group: "Audience", file: "traders.md" },
  { slug: "creators", title: "Creators", group: "Audience", file: "creators.md" },
  { slug: "builders", title: "Builders", group: "Audience", file: "builders.md" },
  { slug: "curve", title: "Curve math", group: "Protocol", file: "curve.md" },
  { slug: "fees", title: "Nested fees", group: "Protocol", file: "fees.md" },
  { slug: "top-10", title: "Top-10", group: "Protocol", file: "top-10.md" },
  { slug: "trust", title: "Trust assumptions", group: "Protocol", file: "trust.md" },
  { slug: "core", title: "CORE", group: "Protocol", file: "core.md" },
  { slug: "routes", title: "Routes", group: "Protocol", file: "routes.md" },
  { slug: "quoting", title: "Atomic quoter", group: "Protocol", file: "quoting.md" },
  { slug: "valuation", title: "Valuation", group: "Protocol", file: "valuation.md" },
  { slug: "markets", title: "Markets API", group: "Builders", file: "markets.md" },
  { slug: "media", title: "Media", group: "Builders", file: "media.md" },
  { slug: "arc", title: "Arc", group: "Reference", file: "arc.md" },
  { slug: "tickers", title: "Ticker registry", group: "Launch", file: "tickers.md" },
  { slug: "admission", title: "Launch admission", group: "Launch", file: "admission.md" },
  { slug: "guardian", title: "Guardian", group: "Launch", file: "guardian.md" },
  { slug: "keeper", title: "Keeper", group: "Launch", file: "keeper.md" },
  { slug: "api", title: "API", group: "Builders", file: "api.md" },
  { slug: "sdk", title: "SDK", group: "Builders", file: "sdk.md" },
  { slug: "examples", title: "Examples", group: "Builders", file: "examples.md" },
  { slug: "events", title: "Events", group: "Builders", file: "events.md" },
  { slug: "deployments", title: "Deployments", group: "Builders", file: "deployments.md" },
  { slug: "versioning", title: "Versioning", group: "Reference", file: "versioning.md" },
  { slug: "changelog", title: "Changelog", group: "Reference", file: "changelog.md" },
  { slug: "policy", title: "Docs policy", group: "Reference", file: "policy.md" },
  { slug: "faq", title: "FAQ", group: "Reference", file: "faq.md" },
  { slug: "glossary", title: "Glossary", group: "Reference", file: "glossary.md" },
];

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
