import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "./db.ts";
import { consumeIssuanceToken } from "./admission.ts";
import { raiseAlert } from "./alerts.ts";
import { saveJob } from "./keeper-jobs.ts";
import { recordTrade, upsertMarket, upsertToken } from "./ingest.ts";
import { applyMigrations, MS_TIMESTAMP_COLUMNS, SCHEMA_VERSION, TABLES } from "./schema.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SCHEMA_VERSION === 9, "schema version 9 adds external_price_marks.kind after v8 journal / v7 identity / v6 BIGINT");
assert(MS_TIMESTAMP_COLUMNS.length >= 6, "millisecond timestamp columns listed");

const dir = mkdtempSync(join(tmpdir(), "reactor-prod-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
const migrated = await store.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
assert(Number(migrated?.n) === 9, "sqlite migrates to v9");

for (const t of TABLES) {
  const row = await store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t);
  assert(row?.name === t, `missing table ${t}`);
}
const markCols = await store.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
assert(markCols.some((c) => c.name === "kind"), "v9 external_price_marks.kind");

for (const idx of [
  "idx_claims_identity",
  "idx_selfburn_identity",
  "idx_flywheel_identity",
  "idx_core_buybacks_identity",
  "idx_reward_events_identity",
  "idx_guardian_events_identity",
]) {
  const row = await store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name=?", idx);
  assert(row?.name === idx, `missing identity index ${idx}`);
}
const claimCols = await store.all<{ name: string }>("PRAGMA table_info(claims)");
assert(
  claimCols.some((c) => c.name === "chain_id") &&
    claimCols.some((c) => c.name === "log_index") &&
    claimCols.some((c) => c.name === "event_kind"),
  "claims has chain_id + log_index + event_kind",
);
const journalCols = await store.all<{ name: string }>("PRAGMA table_info(indexer_event_journal)");
assert(
  ["chain_id", "tx", "log_index", "event_kind", "address"].every((c) => journalCols.some((col) => col.name === c)),
  "journal has canonical identity columns",
);

await upsertToken(store, { address: "0xabc", symbol: "CAT", quote: "0xzec", ts: 100 });
await upsertMarket(store, { token: "0xabc", quote: "0xzec", stage: "bonding", ts: 100 });
await recordTrade(store, undefined, {
  block: 1,
  tx: "0xtx",
  token: "0xabc",
  quote: "0xzec",
  side: "buy",
  source: "curve",
  amountIn: "1000",
  amountOut: "5000",
  notionalQuote: "1000",
  priceQuoteX18: (10n ** 16n).toString(),
  ts: 1_700_000_000,
});

const m = await store.get<{ price_quote_x18: string }>("SELECT price_quote_x18 FROM markets WHERE token=?", "0xabc");
assert(m?.price_quote_x18 === (10n ** 16n).toString(), "canonical price persisted");
const c = await store.get<{ n: number }>("SELECT n FROM candles WHERE token=? AND interval_sec=60", "0xabc");
assert(c && Number(c.n) >= 1, "1m candle");
const nowMs = Date.now();
assert(nowMs > 2_147_483_647, "Date.now() exceeds 32-bit INTEGER");
const locked = await store.tryAdvisoryLock("reactor-keeper", "a", 5_000);
assert(locked, "leader");
const locked2 = await store.tryAdvisoryLock("reactor-keeper", "b", 5_000);
assert(!locked2, "follower blocked");
const lease = await store.get<{ ts: number; lease_until: number }>("SELECT ts, lease_until FROM leader_locks WHERE name=?", "reactor-keeper");
assert(Number(lease?.ts) >= nowMs, `leader_locks.ts=${lease?.ts}`);
await store.releaseLock("reactor-keeper", "a");

const issued = await consumeIssuanceToken(store);
assert(issued.ok, "issuance bucket accepts Date.now() ms");
const bucket = await store.get<{ updated_ms: number }>("SELECT updated_ms FROM issuance_bucket WHERE k=?", "global");
assert(Number(bucket?.updated_ms) >= nowMs, `issuance_bucket.updated_ms=${bucket?.updated_ms}`);
await saveJob(store, "schema-ms", { status: "done", ts: nowMs, note: "ms" }, "MAINTENANCE_SETTLEMENT");
const job = await store.get<{ ts: number }>("SELECT ts FROM keeper_operations WHERE id=?", "schema-ms");
assert(Number(job?.ts) === nowMs, "keeper_operations.ts milliseconds");
await raiseAlert(store, "warn", "SCHEMA_MS", "ms");
const alert = await store.get<{ ts: number }>("SELECT ts FROM alerts WHERE code=?", "SCHEMA_MS");
assert(Number(alert?.ts) >= nowMs, "alerts.ts milliseconds");

await store.close();
rmSync(dir, { recursive: true, force: true });

// Preceding production schema is v8 (#27 journal). v9 adds mark kind only.
{
  const upgradeDir = mkdtempSync(join(tmpdir(), "reactor-v8-"));
  const upgradePath = join(upgradeDir, "v8.sqlite");
  const seed = new DatabaseSync(upgradePath);
  seed.exec(`
    CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_ts INTEGER NOT NULL);
    CREATE TABLE external_price_marks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT, symbol TEXT, source TEXT, usd6 TEXT, ts INTEGER, ok INTEGER, reason TEXT
    );
    CREATE UNIQUE INDEX idx_external_marks_unique ON external_price_marks(token, source, ts);
  `);
  const insertMig = seed.prepare("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)");
  for (let id = 1; id <= 8; id++) insertMig.run(id, 1_700_000_000);
  seed
    .prepare("INSERT INTO external_price_marks(token, symbol, source, usd6, ts, ok, reason) VALUES(?,?,?,?,?,?,?)")
    .run("0xzec", "ZEC", "fused", "42000000", 1_700_000_100, 1, "");
  seed
    .prepare("INSERT INTO external_price_marks(token, symbol, source, usd6, ts, ok, reason) VALUES(?,?,?,?,?,?,?)")
    .run("0xzec", "ZEC", "coingecko", "41900000", 1_700_000_100, 1, "");
  const v8Cols = seed.prepare("PRAGMA table_info(external_price_marks)").all() as Array<{ name: string }>;
  assert(!v8Cols.some((c) => c.name === "kind"), "v8 production marks have no kind");
  seed.close();

  const upgraded = await openStore({ sqlitePath: upgradePath });
  assert((await applyMigrations(upgraded)) === 9, "v8 upgrades to v9");
  const ver = await upgraded.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
  assert(Number(ver?.n) === 9, "schema_migrations records v9");
  const cols = await upgraded.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
  assert(cols.some((c) => c.name === "kind"), "v9 adds external_price_marks.kind");
  const fused = await upgraded.get<{ kind: string }>("SELECT kind FROM external_price_marks WHERE source=?", "fused");
  const obs = await upgraded.get<{ kind: string }>("SELECT kind FROM external_price_marks WHERE source=?", "coingecko");
  assert(fused?.kind === "consensus", "legacy fused/consensus/fail/missing backfill to kind=consensus");
  assert(obs?.kind === "observation", "provider rows default to kind=observation");
  await upgraded.close();
  rmSync(upgradeDir, { recursive: true, force: true });
}

console.log("schema/store tests ok");
