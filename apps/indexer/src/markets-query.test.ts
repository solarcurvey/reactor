import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import { upsertMarket, upsertToken } from "./ingest.ts";
import {
  listMarkets,
  marketCursorValue,
  marketKeysetSql,
  marketOrderSql,
  nextMarketCursor,
  parseMarketSort,
} from "./markets-query.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseMarketSort("price") === "price", "parse price");
assert(parseMarketSort("vol") === "vol", "parse vol");
assert(parseMarketSort("new") === "new" && parseMarketSort("nope") === "new", "parse default");

assert(marketOrderSql("price").includes("price_usd6"), "price order");
assert(marketKeysetSql("price").includes("price_usd6"), "price keyset matches order");
assert(marketKeysetSql("vol").includes("volume_24h_usd6"), "vol keyset matches order");
assert(marketKeysetSql("new").includes("updated_ts"), "new keyset matches order");
assert(!marketKeysetSql("price").includes("updated_ts"), "price keyset must not use updated_ts");

assert(marketCursorValue("price", { price_usd6: "900", updated_ts: 1 }) === "900", "price cursor value");
assert(marketCursorValue("vol", { volume_24h_usd6: "50", updated_ts: 1 }) === "50", "vol cursor value");
assert(marketCursorValue("new", { updated_ts: 77, price_usd6: "9" }) === "77", "new cursor value");

const cur = nextMarketCursor("price", { token: "0xabc", price_usd6: "12", updated_ts: 99 });
assert(cur?.cursor_ts === "12" && cur.cursor_token === "0xabc", "next_cursor follows sort");

const dir = mkdtempSync(join(tmpdir(), "reactor-markets-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });

const rows = [
  { token: "0x0000000000000000000000000000000000000001", ts: 100, vol: "10", px: "30" },
  { token: "0x0000000000000000000000000000000000000002", ts: 300, vol: "40", px: "10" },
  { token: "0x0000000000000000000000000000000000000003", ts: 200, vol: "40", px: "50" },
  { token: "0x0000000000000000000000000000000000000004", ts: 400, vol: "5", px: "20" },
  { token: "0x0000000000000000000000000000000000000005", ts: 50, vol: "99", px: "40" },
];

for (const r of rows) {
  await upsertToken(store, { address: r.token, symbol: `T${r.token.slice(-1)}`, quote: "0xusdc", ts: r.ts });
  await upsertMarket(store, { token: r.token, quote: "0xusdc", stage: "v4", ts: r.ts });
  await store.run(
    "UPDATE markets SET volume_24h_usd6=?, price_usd6=?, updated_ts=? WHERE token=?",
    r.vol,
    r.px,
    r.ts,
    r.token,
  );
}

function tokens(items: Array<Record<string, unknown>>) {
  return items.map((i) => String(i.token));
}

async function pageAll(sort: string, limit = 2) {
  const seen: string[] = [];
  let cursorTs: string | null = null;
  let cursorToken = "";
  for (let i = 0; i < 10; i++) {
    const page = await listMarkets(store, { sort, limit, cursorTs, cursorToken });
    if (i === 0) {
      assert(page.sort === (sort === "vol" || sort === "price" ? sort : "new"), `echo sort ${sort}`);
      const first = page.items[page.items.length - 1];
      assert(page.next_cursor?.cursor_ts === marketCursorValue(page.sort, first ?? {}), `${sort} next_cursor uses sort key`);
    }
    for (const t of tokens(page.items)) {
      assert(!seen.includes(t), `${sort} duplicate ${t}`);
      seen.push(t);
    }
    if (page.items.length < limit || !page.next_cursor) break;
    cursorTs = page.next_cursor.cursor_ts;
    cursorToken = page.next_cursor.cursor_token;
  }
  return seen;
}

const byNew = ["0x0000000000000000000000000000000000000004", "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000005"];
const byVol = ["0x0000000000000000000000000000000000000005", "0x0000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000004"];
const byPrice = ["0x0000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000005", "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000004", "0x0000000000000000000000000000000000000002"];

const gotNew = await pageAll("new");
const gotVol = await pageAll("vol");
const gotPrice = await pageAll("price");
assert(gotNew.join() === byNew.join(), `new pages ${gotNew}`);
assert(gotVol.join() === byVol.join(), `vol pages ${gotVol}`);
assert(gotPrice.join() === byPrice.join(), `price pages ${gotPrice}`);

const pricePage1 = await listMarkets(store, { sort: "price", limit: 2 });
assert(tokens(pricePage1.items).join() === byPrice.slice(0, 2).join(), "price page 1");
assert(pricePage1.next_cursor?.cursor_ts === "40", "next_cursor is price_usd6 of last row, not updated_ts=50");
assert(pricePage1.next_cursor?.cursor_token === byPrice[1], "price page 1 cursor token");
const pricePage2 = await listMarkets(store, {
  sort: "price",
  limit: 2,
  cursorTs: pricePage1.next_cursor!.cursor_ts,
  cursorToken: pricePage1.next_cursor!.cursor_token,
});
assert(tokens(pricePage2.items).join() === byPrice.slice(2, 4).join(), "price page 2 continues on price");

const fullPrice = await listMarkets(store, { sort: "price", limit: 100 });
assert(fullPrice.total === 5 && tokens(fullPrice.items).join() === byPrice.join(), "full price order");
assert(
  fullPrice.items.every((i) => i.current_supply != null && String(i.current_supply) !== ""),
  "listMarkets projects tokens.current_supply for burn-adjusted FDV",
);

{
  const page1 = await listMarkets(store, { sort: "price", limit: 2 });
  const seen = tokens(page1.items);
  const ahead = "0x00000000000000000000000000000000000000aa";
  await upsertToken(store, { address: ahead, symbol: "NEW", quote: "0xusdc", ts: 999 });
  await upsertMarket(store, { token: ahead, quote: "0xusdc", stage: "v4", ts: 999 });
  await store.run(
    "UPDATE markets SET volume_24h_usd6=?, price_usd6=?, updated_ts=? WHERE token=?",
    "1",
    "999",
    999,
    ahead,
  );
  const page2 = await listMarkets(store, {
    sort: "price",
    limit: 2,
    cursorTs: page1.next_cursor!.cursor_ts,
    cursorToken: page1.next_cursor!.cursor_token,
  });
  const page2Tokens = tokens(page2.items);
  assert(page2Tokens.every((t) => !seen.includes(t)), "insert-ahead does not duplicate page 1");
  assert(!page2Tokens.includes(ahead), "row inserted ahead of the cursor is omitted from later pages (not a frozen snapshot)");
  assert(page2Tokens.join() === byPrice.slice(2, 4).join(), "page 2 stays deterministic on the original tail");
}

await store.close();
rmSync(dir, { recursive: true, force: true });
console.log("markets keyset tests ok");
