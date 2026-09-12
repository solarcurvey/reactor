import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import { upsertMarket, upsertToken } from "./ingest.ts";
import { aggregateTokenPage, listCandles, listSwaps } from "./page-reads.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "reactor-page-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
const token = "0x00000000000000000000000000000000000000aa";
const MINT = (10n ** 27n).toString();

await upsertToken(store, { address: token, symbol: "PAG", name: "Page", quote: "0xusdc", supply: MINT, ts: 100 });
await upsertMarket(store, { token, quote: "0xusdc", stage: "v4", ts: 100, marketLive: true });

const t0 = 1_700_000_000;
await store.run(
  "INSERT INTO candles(token,interval_sec,t,o,h,l,c,v,n) VALUES(?,?,?,?,?,?,?,?,?)",
  token,
  300,
  t0,
  "1",
  "2",
  "1",
  "2",
  "10",
  2,
);

await store.run(
  "INSERT INTO trades(chain_id,block,tx,log_index,token,quote,side,source,amount_in,amount_out,notional_quote,price_quote_x18,sqrt_price,holders_fee,flywheel_fee,core_fee,ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  5042002,
  9,
  "0xabc",
  0,
  token,
  "0xusdc",
  "buy",
  "v4",
  "1",
  "2",
  "100",
  "1",
  "0",
  "2",
  "1",
  "0",
  t0,
);

const bad = await aggregateTokenPage(store, "not-an-address");
assert(!bad.ok && bad.reason === "invalid token", "invalid token");
const miss = await aggregateTokenPage(store, "0x00000000000000000000000000000000000000ff");
assert(!miss.ok && miss.reason === "market not found", "404 market");

const page = await aggregateTokenPage(store, token.toUpperCase(), { interval: "5m", candleLimit: 10, swapLimit: 20 });
assert(page.ok, "aggregate ok");
if (page.ok) {
  assert(String(page.market.symbol) === "PAG", "market from same SELECT as /markets");
  assert(page.token === token, "normalized token");
  assert(page.interval === "5m", "interval");
  assert(page.candles.length >= 1, "candles present");
  assert(page.swaps.length === 1 && String(page.swaps[0]!.notional) === "100", "swaps present");
  assert(page.sparse === true, "one real candle is sparse");
}

const candles = await listCandles(store, token, { interval: "5m", limit: 4 });
const swaps = await listSwaps(store, token, { limit: 5 });
assert(candles && candles.candles.length >= 1, "listCandles");
assert(swaps && swaps.length === 1, "listSwaps");

const started = Date.now();
await Promise.all([getIgnored(store, token), getIgnored(store, token), getIgnored(store, token)]);
assert(Date.now() - started < 5_000, "parallel page reads finish together");

await store.close();
rmSync(dir, { recursive: true, force: true });
console.log("page-reads tests ok");

async function getIgnored(s: typeof store, t: string) {
  return aggregateTokenPage(s, t, { interval: "5m" });
}
