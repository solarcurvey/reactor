import assert from "node:assert/strict";
import { loadDocsSearchIndex } from "./docs.ts";
import { navHaystack, searchDocs, searchHaystack } from "./docs-search.ts";

/** Raw virtualQuote0 — body of curve.md only, not title/slug/group/blurb/keywords. */
const BODY_ONLY = "5365128027";

const index = loadDocsSearchIndex();
assert.ok(index.length > 0, "search index empty");

const bodyHits = searchDocs(index, BODY_ONLY);
assert.ok(
  bodyHits.some((h) => h.slug === "curve"),
  "body-only term 5365128027 must find Curve math",
);
for (const h of bodyHits) {
  assert.ok(
    !navHaystack(h).includes(BODY_ONLY.toLowerCase()),
    `${h.file} leaked the body-only term into title/slug/group/blurb/keywords`,
  );
  assert.ok(searchHaystack(h).includes(BODY_ONLY.toLowerCase()), `${h.file} haystack missing body`);
}

const navHits = searchDocs(index, "feeLegs");
assert.ok(navHits.some((h) => h.slug === "fees"), "metadata term feeLegs must still find Nested fees");

const empty = searchDocs(index, "   ");
assert.equal(empty.length, index.length, "blank query returns the full handbook");

console.log(`docs full-text search ok (body-only hits: ${bodyHits.map((h) => h.slug).join(",")})`);
