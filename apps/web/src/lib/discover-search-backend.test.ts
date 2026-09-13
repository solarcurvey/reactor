/**
 * #40 AC: Discover/search must be GET /markets (q + board + cursor), not a
 * client filter of the first loaded page. `filterMarkets` is deleted from the app.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const discover = src("src/app/page.tsx");
const search = src("src/app/search/page.tsx");
const marketUi = src("src/lib/market-ui.ts");
const hooks = src("src/lib/hooks.ts");

for (const [name, text] of [
  ["Discover", discover],
  ["Search", search],
  ["market-ui", marketUi],
  ["hooks", hooks],
] as const) {
  assert.equal(text.includes("filterMarkets"), false, `${name} must not contain filterMarkets`);
}

assert.match(discover, /useMarketsInfinite\(\{\s*q: deferredQ,\s*board: filter/);
assert.match(search, /useMarketsInfinite\(\{/);
assert.match(hooks, /fetchMarketsPage/);
assert.match(hooks, /useInfiniteQuery/);
assert.doesNotMatch(discover, /filterMarkets\(/);
assert.doesNotMatch(search, /data \?\? \[\]/);

console.log("discover-search-backend ok");
