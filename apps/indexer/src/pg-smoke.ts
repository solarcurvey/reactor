/**
 * Idempotent Postgres smoke: schema + one index cycle.
 * Requires DATABASE_URL=postgres://…
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke
 */
import { openStore } from "./db.ts";
import { recordTrade, upsertMarket, upsertToken } from "./ingest.ts";
import { persistVenue, planFeeExemptRoute } from "./route-graph.ts";
import { saveJob } from "./keeper-jobs.ts";
import { TABLES } from "./schema.ts";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("postgres")) {
  console.error("DATABASE_URL must be postgres://… — SQLite is local-only");
  process.exit(2);
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const store = await openStore({ databaseUrl: url });
assert(store.dialect === "postgres", "dialect");

for (const t of TABLES) {
  const row = await store.get<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=?) AS exists",
    t,
  );
  assert(row?.exists, `missing ${t}`);
}

const token = "0xabcabcabcabcabcabcabcabcabcabcabcabcabca";
const quote = "0x1111111111111111111111111111111111111111";
const proto = "0x2222222222222222222222222222222222222222";
await upsertToken(store, { address: token, symbol: "PG", quote, ts: 100 });
await upsertMarket(store, { token, quote, stage: "bonding", ts: 100 });
await upsertToken(store, { address: token, symbol: "PG", quote, ts: 100 });
await upsertMarket(store, { token, quote, stage: "bonding", ts: 101 });
await recordTrade(store, undefined, {
  block: 1,
  tx: "0xpg1",
  token,
  quote,
  side: "buy",
  source: "curve",
  amountIn: "1000",
  amountOut: "5000",
  notionalQuote: "1000",
  priceQuoteX18: (10n ** 16n).toString(),
  ts: 1_700_000_000,
});
await recordTrade(store, undefined, {
  block: 1,
  tx: "0xpg1",
  token,
  quote,
  side: "buy",
  source: "curve",
  amountIn: "1000",
  amountOut: "5000",
  notionalQuote: "1000",
  priceQuoteX18: (10n ** 16n).toString(),
  ts: 1_700_000_000,
});
const m = await store.get<{ n: string }>("SELECT COUNT(*)::text AS n FROM markets WHERE token=?", token.toLowerCase());
assert(Number(m?.n ?? 0) === 1, "markets idempotent");
const c = await store.get<{ n: number }>("SELECT n FROM candles WHERE token=? AND interval_sec=60", token.toLowerCase());
assert(c && Number(c.n) >= 1, "1m candle");
await persistVenue(store, {
  tokenIn: quote,
  tokenOut: token,
  adapter: proto,
  kind: "protocol",
  data: "0x01",
  exists: true,
  approved: true,
});
const planned = await planFeeExemptRoute(store, quote, token, new Set([proto]));
assert(planned.hops.length === 1, "shared planner");
const jobNow = Date.now();
await saveJob(store, "settle:pg-smoke", { status: "done", ts: jobNow, note: planned.reason }, "MAINTENANCE_SETTLEMENT");
const job = await store.get<{ kind: string; ts: string | number }>("SELECT kind, ts FROM keeper_operations WHERE id=?", "settle:pg-smoke");
assert(job?.kind === "MAINTENANCE_SETTLEMENT", "job kind");
assert(Number(job?.ts) === jobNow, "keeper_operations.ts is Date.now() ms");
for (const [table, column] of [
  ["admission_hits", "ts"],
  ["issuance_bucket", "updated_ms"],
  ["leader_locks", "ts"],
  ["leader_locks", "lease_until"],
  ["keeper_operations", "ts"],
  ["alerts", "ts"],
] as const) {
  const col = await store.get<{ data_type: string }>(
    "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=? AND column_name=?",
    table,
    column,
  );
  assert(col?.data_type === "bigint", `${table}.${column} bigint`);
}
await store.close();
console.log("postgres smoke ok");
