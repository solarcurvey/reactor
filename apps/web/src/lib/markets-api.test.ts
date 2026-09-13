import assert from "node:assert/strict";
import { boardToQuery, marketsSearchParams, searchMissesIfClientFiltered } from "./markets-api.ts";

assert.equal(boardToQuery("Trending").board, "trending");
assert.equal(boardToQuery("Trending").sort, "vol");
assert.equal(boardToQuery("Buy+Burn").board, "buy+burn");
assert.equal(boardToQuery("USDC-quoted").board, "usdc-quoted");

const p = marketsSearchParams({ q: "zlate", board: "New", limit: 20 });
assert.equal(p.get("q"), "zlate");
assert.equal(p.get("board"), "new");
assert.equal(p.get("limit"), "20");
assert.equal(p.get("cursor_ts"), null);

const paged = marketsSearchParams({
  q: "",
  board: "Trending",
  cursor: { cursor_ts: "99", cursor_token: "0xabc" },
});
assert.equal(paged.get("board"), "trending");
assert.equal(paged.get("sort"), "vol");
assert.equal(paged.get("cursor_ts"), "99");
assert.equal(paged.get("cursor_token"), "0xabc");

assert.equal(
  searchMissesIfClientFiltered(["P01", "P02"], "ZLATE", ["ZLATE"]),
  true,
  "a hit only on a later indexer page is invisible if the client filtered page 1",
);
assert.equal(searchMissesIfClientFiltered(["ZLATE"], "ZLATE", ["ZLATE"]), false);

console.log("markets-api ok");
