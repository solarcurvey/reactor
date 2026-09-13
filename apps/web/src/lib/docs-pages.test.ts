import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adjacentDocs, DOCS, docHref, slugify } from "./docs-nav.ts";
import { loadReleaseIdentity } from "./release-identity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const docsDir = join(root, "docs");

const requiredSlugs = [
  "",
  "local",
  "traders",
  "creators",
  "builders",
  "economics",
  "lifecycle",
  "curve",
  "fees",
  "rewards",
  "top-10",
  "core",
  "routes",
  "quoting",
  "valuation",
  "architecture",
  "trust",
  "security",
  "web-security",
  "tickers",
  "admission",
  "guardian",
  "keeper",
  "automation",
  "api",
  "sdk",
  "examples",
  "events",
  "markets",
  "perf",
  "media",
  "observability",
  "deployments",
  "arc",
  "faq",
  "glossary",
  "troubleshooting",
  "versioning",
  "changelog",
  "policy",
  "ci",
  "publicization",
];

const slugs = new Set(DOCS.map((d) => d.slug));
for (const s of requiredSlugs) {
  assert.ok(slugs.has(s), `handbook missing nav slug ${s || "(home)"}`);
}

const seenFiles = new Set<string>();
for (const d of DOCS) {
  assert.ok(d.title.trim(), `${d.file} missing title`);
  assert.ok(d.group.trim(), `${d.file} missing group`);
  assert.ok(d.blurb.trim().length >= 20, `${d.file} missing search blurb`);
  assert.ok(d.keywords.trim().length >= 8, `${d.file} missing search keywords`);
  assert.ok(!seenFiles.has(d.file), `duplicate handbook file ${d.file}`);
  seenFiles.add(d.file);

  const p = join(docsDir, d.file);
  assert.ok(existsSync(p), `missing ${d.file}`);
  const md = readFileSync(p, "utf8");
  assert.ok(/^# /m.test(md), `${d.file} needs an H1`);
  assert.ok(!/audited and trustless/i.test(md), `${d.file} claims audited and trustless`);
  if (d.file !== "deployments.md" && d.file !== "changelog.md" && d.file !== "versioning.md") {
    assert.ok(md.includes("/docs/"), `${d.file} should cross-link the handbook`);
  }
}

assert.equal(docHref(""), "/docs");
assert.equal(docHref("fees"), "/docs/fees");
assert.equal(slugify("Nested fees"), "nested-fees");

const home = adjacentDocs("");
assert.equal(home.next?.slug, "local");
assert.equal(home.prev, undefined);
const last = adjacentDocs(DOCS[DOCS.length - 1]!.slug);
assert.equal(last.next, undefined);

const rel = loadReleaseIdentity(root);
const llms = readFileSync(join(docsDir, "llms.txt"), "utf8");
const publicLlms = readFileSync(join(root, "apps/web/public/llms.txt"), "utf8");
assert.equal(llms, publicLlms, "docs/llms.txt drifted from apps/web/public/llms.txt");
assert.match(llms, new RegExp(`Protocol ${rel.protocolVersion.replace(/\./g, "\\.")}`));
assert.match(llms, /\/docs\/economics/);
assert.match(llms, /\/docs\/security/);
assert.match(llms, /\/docs\/troubleshooting/);
assert.match(llms, /\/docs\/ci/);
assert.match(llms, /\/docs\/perf/);

const index = readFileSync(join(docsDir, "index.md"), "utf8");
assert.match(index, /2% holders/);
assert.match(index, /1B/);
assert.match(index, /24h/);

console.log(`docs handbook pages ok (${DOCS.length} nav entries)`);
