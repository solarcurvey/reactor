import assert from "node:assert/strict";
import { checkDocsLinks, extractLinks, resolveDocHref } from "./docs-links.ts";

const errors = checkDocsLinks();
assert.equal(errors.length, 0, errors.join("\n"));

const hits = extractLinks("See [CI](/docs/ci) and [missing](/docs/nope-page).\n", "docs/ci.md");
assert.equal(hits.length, 2);
assert.equal(resolveDocHref("docs/ci.md", "/docs/ci"), null);
assert.match(resolveDocHref("docs/ci.md", "/docs/nope-page") ?? "", /unknown docs slug/);
assert.equal(resolveDocHref("docs/ci.md", "../.github/workflows/ci.yml"), null);
assert.match(resolveDocHref("docs/ci.md", "../.github/workflows/missing.yml") ?? "", /missing file/);
assert.equal(resolveDocHref("docs/changelog.md", "docs/versioning.md"), null);
assert.equal(resolveDocHref("docs/ci.md", "https://example.com/ignored"), null);
assert.match(resolveDocHref("docs/ci.md", "/traders") ?? "", /not a docs page/);

console.log("docs-links test ok");
