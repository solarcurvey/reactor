import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "./db.ts";
import { applyOnchainTotalSupply, applyTokenLevelBurn, upsertMarket, upsertToken, recordTrade } from "./ingest.ts";
import {
  computeTop10Epoch,
  persistTop10Epoch,
  readTop10Epoch,
  refreshTop10Epoch,
  failClosedTop10,
  TOP10_SOURCE,
} from "./top10-rank.ts";
import { MARK_WINDOW_SEC, TOP10_FLOOR_USDC } from "../../../packages/reactor/src/top10.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const USDC = "0x0000000000000000000000000000000000000001";
const ZEC = "0x0000000000000000000000000000000000000002";
const CORE = "0x00000000000000000000000000000000000000c0";
const BIG = "0x0000000000000000000000000000000000000b01";
const NESTED = "0x0000000000000000000000000000000000000b02";
const ZCAT = "0x0000000000000000000000000000000000000c01";
const STALE = "0x0000000000000000000000000000000000000b03";
const BOND = "0x0000000000000000000000000000000000000b04";
const RIVAL = "0x0000000000000000000000000000000000000b05";

const SUPPLY = 1_000_000_000n * 10n ** 18n;
/** $0.0004 / token → $400k FDV on 1B. */
const PX_400K = 4n * 10n ** 14n;
/** $0.00035 / token → $350k FDV on 1B. */
const PX_350K = 35n * 10n ** 13n;
const now = 1_800_000_000;

async function seedQuote(store: Store, token: string, symbol: string, decimals: number, usdPegOne: boolean, parent = "") {
  await store.run(
    `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
     VALUES(?,?,?,?,0,1,?,?,0,?,0) ON CONFLICT(token) DO UPDATE SET usd_peg_one=excluded.usd_peg_one, parent_quote=excluded.parent_quote`,
    token.toLowerCase(),
    symbol,
    symbol,
    decimals,
    usdPegOne ? 1 : 0,
    usdPegOne ? 0 : 1,
    parent,
  );
}

async function seedMarket(
  store: Store,
  token: string,
  symbol: string,
  quote: string,
  live: boolean,
  supply = SUPPLY,
) {
  await upsertToken(store, { address: token, symbol, ticker: symbol, quote, supply: supply.toString(), decimals: 18, ts: now });
  await upsertMarket(store, { token, quote, stage: live ? "v4" : "bonding", marketLive: live, ts: now });
}

async function seedWindowTrades(store: Store, token: string, quote: string, priceX18: bigint, n = 3, start = now - 60) {
  for (let i = 0; i < n; i++) {
    await recordTrade(store, undefined, {
      block: 10 + i,
      tx: `0x${token.slice(-8)}${i}`,
      logIndex: i,
      token,
      quote,
      side: "buy",
      source: "v4",
      amountIn: "1000000",
      amountOut: "1",
      notionalQuote: "1000000",
      priceQuoteX18: priceX18.toString(),
      ts: start - i * 10,
    });
  }
}

const dir = mkdtempSync(join(tmpdir(), "reactor-top10-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });

await seedQuote(store, USDC, "USDC", 6, true);
await seedQuote(store, ZEC, "ZEC", 8, false);
await store.run(
  "INSERT INTO external_price_marks(token,symbol,source,usd6,ts,ok,reason) VALUES(?,?,?,?,?,?,?)",
  ZEC.toLowerCase(),
  "ZEC",
  "fused",
  "50000000",
  now,
  1,
  "test",
);
await seedQuote(store, ZCAT, "ZCAT", 18, false, ZEC.toLowerCase());
await seedMarket(store, ZCAT, "ZCAT", ZEC, true);
await store.run("UPDATE markets SET price_quote_x18=? WHERE token=?", (20n * 10n ** 15n).toString(), ZCAT.toLowerCase());

await seedMarket(store, BIG, "BIG", USDC, true);
await seedWindowTrades(store, BIG, USDC, PX_400K);
await seedMarket(store, CORE, "CORE", USDC, true);
await seedWindowTrades(store, CORE, USDC, 9n * 10n ** 15n);
await seedMarket(store, BOND, "BOND", USDC, false);
await seedWindowTrades(store, BOND, USDC, PX_400K);

await seedMarket(store, NESTED, "NEST", ZCAT, true);
await seedWindowTrades(store, NESTED, ZCAT, 5n * 10n ** 17n);

const first = await computeTop10Epoch(store, { coreAddresses: [CORE], nowSec: now });
assert(first.source === TOP10_SOURCE, "source");
assert(!first.pauseEpoch, `first pause ${first.reason}`);
assert(first.rows.every((r) => r.token !== CORE.toLowerCase()), "CORE excluded data-plane");
assert(first.rows.every((r) => r.token !== BOND.toLowerCase()), "bonding excluded");
assert(first.rows.some((r) => r.token === BIG.toLowerCase()), "USDC graduate ranks");
const nest = first.rows.find((r) => r.token === NESTED.toLowerCase());
assert(nest, "nested quote ranks via ValuationService ancestry");
assert(BigInt(nest!.markUsdc) >= TOP10_FLOOR_USDC, `nested mark ${nest!.markUsdc}`);

await persistTop10Epoch(store, first);
const readBack = await readTop10Epoch(store);
assert(readBack?.rows.length === first.rows.length, "persisted snapshot matches compute");
assert(JSON.stringify(readBack?.rows) === JSON.stringify(first.rows), "canonical payload identical");

await seedMarket(store, RIVAL, "RIVAL", USDC, true);
await seedWindowTrades(store, RIVAL, USDC, PX_350K);
const withRival = await computeTop10Epoch(store, { coreAddresses: [CORE], nowSec: now });
const bigBefore = withRival.rows.find((r) => r.token === BIG.toLowerCase())!;
const rivalBefore = withRival.rows.find((r) => r.token === RIVAL.toLowerCase());
assert(rivalBefore, "RIVAL ranks at $350k");
assert(bigBefore.rank < rivalBefore!.rank, "full-supply BIG outranks RIVAL");
assert(BigInt(bigBefore.markUsdc) > BigInt(rivalBefore!.markUsdc), "BIG FDV above RIVAL before holder burn");

const protoBurn = (400_000_000n * 10n ** 18n).toString();
await store.run(
  "INSERT INTO selfburn(token,quote,amount,burned,kind,block,tx,ts) VALUES(?,?,?,?,?,?,?,?)",
  BIG.toLowerCase(),
  USDC.toLowerCase(),
  "0",
  protoBurn,
  "SelfBurnExecuted",
  99,
  "0xselfburn",
  now,
);
await store.run(
  "INSERT INTO selfburn(token,quote,amount,burned,kind,block,tx,ts) VALUES(?,?,?,?,?,?,?,?)",
  BIG.toLowerCase(),
  USDC.toLowerCase(),
  "0",
  (100_000_000n * 10n ** 18n).toString(),
  "Top10Buy",
  100,
  "0xtop10buy",
  now,
);
const afterProto = await computeTop10Epoch(store, { coreAddresses: [CORE], nowSec: now });
const bigAfterProto = afterProto.rows.find((r) => r.token === BIG.toLowerCase());
assert(bigAfterProto, "protocol-only burns must not drop BIG");
assert(bigAfterProto!.markUsdc === bigBefore.markUsdc, "SelfBurnExecuted/Top10Buy are not the supply path");
assert(bigAfterProto!.rank === bigBefore.rank, "protocol attribution must not change rank");

const holderBurn = 500_000_000n * 10n ** 18n;
const applied = await applyTokenLevelBurn(store, {
  token: BIG,
  burned: holderBurn.toString(),
  account: "0xholder",
  block: 101,
  tx: "0xholderburn",
  ts: now,
  chainId: 1,
  logIndex: 0,
  eventKind: "Burned",
});
assert(applied, "holder TokenBurned writes current_supply");
const afterHolder = await computeTop10Epoch(store, { coreAddresses: [CORE], nowSec: now });
assert(
  !afterHolder.rows.some((r) => r.token === BIG.toLowerCase()),
  "holder burn must drop BIG below the $250k floor",
);
assert(afterHolder.rows.some((r) => r.token === RIVAL.toLowerCase()), "RIVAL still ranks after BIG holder burn");
assert(BigInt(rivalBefore!.markUsdc) === BigInt(afterHolder.rows.find((r) => r.token === RIVAL.toLowerCase())!.markUsdc), "RIVAL mark unchanged");

await applyOnchainTotalSupply(store, BIG, SUPPLY);
const restored = await computeTop10Epoch(store, { coreAddresses: [CORE], nowSec: now });
const bigRestored = restored.rows.find((r) => r.token === BIG.toLowerCase());
assert(bigRestored, "totalSupply() reconcile restores rank");
assert(bigRestored!.markUsdc === bigBefore.markUsdc, "reconciled current_supply is authoritative");

await seedMarket(store, STALE, "STALE", ZEC, true);
await seedWindowTrades(store, STALE, ZEC, 20n * 10n ** 15n);
await store.run(
  "INSERT INTO top10_candidate_rows(epoch_id,rank,token,symbol,quote,mark_usdc,weight_bps) VALUES(?,?,?,?,?,?,?)",
  "current",
  9,
  STALE.toLowerCase(),
  "STALE",
  ZEC.toLowerCase(),
  (400_000n * 1_000_000n).toString(),
  100,
);
await store.run(
  "INSERT INTO external_price_marks(token,symbol,source,usd6,ts,ok,reason) VALUES(?,?,?,?,?,?,?)",
  ZEC.toLowerCase(),
  "ZEC",
  "fused",
  "50000000",
  now - 10_000,
  0,
  "stale",
);
const paused = await computeTop10Epoch(store, { coreAddresses: [CORE], nowSec: now });
assert(paused.pauseEpoch, `stale external on prior-ranked candidate must fail closed: ${paused.reason}`);
assert(paused.rows.length === 0, "pause returns no guessed ranks");

const closed = failClosedTop10("indexer down");
assert(closed.pauseEpoch && closed.rows.length === 0, "fail-closed payload");

const scaleDir = mkdtempSync(join(tmpdir(), "reactor-top10-scale-"));
const scale = await openStore({ sqlitePath: join(scaleDir, "s.sqlite") });
await seedQuote(scale, USDC, "USDC", 6, true);
const N = 8_000;
await scale.transaction(async (tx) => {
  for (let i = 0; i < N; i++) {
    const token = `0x${(i + 1).toString(16).padStart(40, "0")}`;
    await upsertToken(tx, { address: token, symbol: `T${i}`, quote: USDC, supply: SUPPLY.toString(), decimals: 18, ts: now });
    await upsertMarket(tx, { token, quote: USDC, stage: "v4", marketLive: true, ts: now });
  }
});
const live = `0x${(N + 1).toString(16).padStart(40, "0")}`;
await upsertToken(scale, { address: live, symbol: "LIVE", quote: USDC, supply: SUPPLY.toString(), decimals: 18, ts: now });
await upsertMarket(scale, { token: live, quote: USDC, stage: "v4", marketLive: true, ts: now });
await seedWindowTrades(scale, live, USDC, PX_400K);

const fetchCalls: string[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetchCalls.push(String(input));
  throw new Error(`unexpected fetch ${input}`);
}) as typeof fetch;

const t0 = Date.now();
const scaled = await refreshTop10Epoch(scale, { coreAddresses: [CORE], nowSec: now });
const elapsed = Date.now() - t0;
globalThis.fetch = origFetch;

assert(fetchCalls.length === 0, `scale ranking must not HTTP/RPC fanout, got ${fetchCalls.join(",")}`);
assert(scaled.candidates === N + 1, `indexed ${scaled.candidates} != ${N + 1}`);
assert(scaled.rows.length === 1 && scaled.rows[0]!.token === live.toLowerCase(), "only the window-qualified name ranks");
assert(elapsed < 30_000, `8k indexed markets should stay in-process, took ${elapsed}ms`);
const again = await readTop10Epoch(scale);
assert(again && again.rows[0]!.token === scaled.rows[0]!.token, "keeper and page read the same snapshot");

const routeSrc = readFileSync(new URL("../../web/src/app/api/reactor/top10/route.ts", import.meta.url), "utf8");
assert(!routeSrc.includes("discoverTop10"), "web endpoint must not call discoverTop10");
assert(!routeSrc.includes("createPublicClient"), "web endpoint must not open RPC");
assert(routeSrc.includes("/top10"), "web endpoint proxies indexer /top10");

const marketdataSrc = readFileSync(new URL("../../web/src/lib/marketdata.ts", import.meta.url), "utf8");
assert(!/export async function discoverTop10/.test(marketdataSrc), "ranking removed from marketdata.ts");
assert(!marketdataSrc.includes("fee: 3000"), "no assumed 0.30% hookless fallback");
assert(!marketdataSrc.includes("allTokensLength"), "web marketdata no longer enumerates Factory tokens");

const rankSrc = readFileSync(new URL("./top10-rank.ts", import.meta.url), "utf8");
assert(rankSrc.includes("current_supply"), "ranker reads persisted current_supply");
assert(!rankSrc.includes("kind IN ('SelfBurnExecuted'"), "ranker must not sum protocol SelfBurn/Top10Buy");
assert(!rankSrc.includes("loadBurnedByToken"), "ranker must not load protocol-burn sums");

await store.close();
await scale.close();
rmSync(dir, { recursive: true, force: true });
rmSync(scaleDir, { recursive: true, force: true });
console.log("top10 ranker tests ok");
