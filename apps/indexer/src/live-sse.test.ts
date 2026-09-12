/**
 * Confirmed CORE / Top-10 buy+burn SSE payloads (issue #38).
 * Published only after persistTickBatch commit; amounts travel with the event.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { openStore } from "./db.ts";
import { persistTickBatch, type TickLog, type TickPersistCtx } from "./tick-persist.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function addr(seed: string): string {
  return `0x${seed.padEnd(40, "0")}`.toLowerCase();
}

function log(name: string, args: Record<string, unknown>, extra?: Partial<TickLog>): TickLog {
  return {
    eventName: name,
    args,
    address: extra?.address,
    blockNumber: extra?.blockNumber ?? 10n,
    transactionHash: extra?.transactionHash ?? `0x${"ab".repeat(32)}`,
    logIndex: extra?.logIndex ?? 0,
  };
}

function ctx(): TickPersistCtx {
  return {
    chainId: 5042002,
    factory: addr("f1"),
    hook: addr("h1"),
    tokenByPool: new Map(),
    quoteDec: new Map([[addr("usdc"), 6]]),
  };
}

const timestamps = new Map<number, number>([[10, 1_700_000_000]]);

const dir = mkdtempSync(join(tmpdir(), "reactor-live-sse-"));
const store = await openStore(join(dir, "t.db"));

const quote = addr("usdc");
const token = addr("tok");
const coreTx = `0x${randomBytes(32).toString("hex")}`;
const topTx = `0x${randomBytes(32).toString("hex")}`;
const accrueTx = `0x${randomBytes(32).toString("hex")}`;

const events = await persistTickBatch(store, {
  logs: [
    log(
      "BuybackExecuted",
      { quote, quoteIn: "2500000", coreOut: "1000000000000000000" },
      { transactionHash: coreTx, logIndex: 1, address: addr("buyback") },
    ),
    log("COREBurned", { amount: "1000000000000000000" }, { transactionHash: coreTx, logIndex: 2, address: addr("buyback") }),
    log(
      "Top10Buy",
      { epoch: 7n, token, usdcIn: "4000000", burned: "2000000000000000000" },
      { transactionHash: topTx, logIndex: 3, address: addr("fly") },
    ),
    log(
      "SelfBurnAccrued",
      { token, quote, amount: "9" },
      { transactionHash: accrueTx, logIndex: 4, address: addr("self") },
    ),
  ],
  timestamps,
  cursorBlock: "42",
  cursorHash: "0xabc",
  ctx: ctx(),
});

const core = events.filter((e) => e.type === "core");
assert(core.length === 2, `expected two core SSE rows, got ${core.length}`);
const bought = core.find((e) => (e.data as { name?: string }).name === "BuybackExecuted")?.data as Record<string, unknown>;
assert(bought?.tx === coreTx, "BuybackExecuted tx");
assert(bought?.confirmed === true, "BuybackExecuted confirmed after commit");
assert(bought?.quoteIn === "2500000", "BuybackExecuted quoteIn");
assert(bought?.coreOut === "1000000000000000000", "BuybackExecuted coreOut");

const burnedCore = core.find((e) => (e.data as { name?: string }).name === "COREBurned")?.data as Record<string, unknown>;
assert(burnedCore?.coreOut === "1000000000000000000", "COREBurned amount as coreOut");
assert(burnedCore?.confirmed === true, "COREBurned confirmed");

const burns = events.filter((e) => e.type === "burn");
const top = burns.find((e) => (e.data as { name?: string }).name === "Top10Buy")?.data as Record<string, unknown>;
assert(top?.tx === topTx, "Top10Buy tx");
assert(top?.confirmed === true, "Top10Buy confirmed");
assert(top?.amount === "4000000", "Top10Buy usdcIn as amount");
assert(top?.burned === "2000000000000000000", "Top10Buy burned");
assert(String(top?.token).toLowerCase() === token, "Top10Buy token");

const accrued = burns.find((e) => (e.data as { name?: string }).name === "SelfBurnAccrued");
assert(accrued, "SelfBurnAccrued still published as burn (UI must not toast it)");

assert(!events.some((e) => e.type === "top10"), "EpochSubmitted is the only top10 SSE; none in this tick");

await store.close();
rmSync(dir, { recursive: true, force: true });
console.log("live-sse.test.ts: ok");
