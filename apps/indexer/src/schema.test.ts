import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import { consumeIssuanceToken } from "./admission.ts";
import { raiseAlert } from "./alerts.ts";
import { saveJob } from "./keeper-jobs.ts";
import { recordTrade, upsertMarket, upsertToken } from "./ingest.ts";
import { applyMigrations, migrationApplied, MS_TIMESTAMP_COLUMNS, SCHEMA_VERSION, TABLES } from "./schema.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SCHEMA_VERSION === 10, "schema version 10 adds external_price_marks.kind; v9 reserved for #23 current_supply");
assert(MS_TIMESTAMP_COLUMNS.length >= 6, "millisecond timestamp columns listed");

const dir = mkdtempSync(join(tmpdir(), "reactor-prod-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
const migrated = await store.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
assert(Number(migrated?.n) === 10, "sqlite migrates to v10");

for (const t of TABLES) {
  const row = await store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t);
  assert(row?.name === t, `missing table ${t}`);
}
const markCols = await store.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
assert(markCols.some((c) => c.name === "kind"), "v10 external_price_marks.kind");

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

// Actual preceding production schema is main v8 (#27 journal). Pin a real install back to v8,
// then prove v10 kind + backfill. v9 is left unused so #23 can still insert current_supply.
{
  const upgradeDir = mkdtempSync(join(tmpdir(), "reactor-v8-"));
  const upgradePath = join(upgradeDir, "v8.sqlite");
  const upgraded = await openStore({ sqlitePath: upgradePath });
  assert((await applyMigrations(upgraded)) === 10, "fresh install reaches v10");
  const journal = await upgraded.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='indexer_event_journal'",
  );
  assert(journal?.name === "indexer_event_journal", "post-#27 journal exists before pin");
  const identity = await upgraded.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_selfburn_identity'",
  );
  assert(identity?.name === "idx_selfburn_identity", "post-#27 identity index exists before pin");
  await upgraded.exec("ALTER TABLE external_price_marks DROP COLUMN kind");
  await upgraded.run("DELETE FROM schema_migrations WHERE id >= 9");
  await upgraded.run(
    "INSERT INTO external_price_marks(token, symbol, source, usd6, ts, ok, reason) VALUES(?,?,?,?,?,?,?)",
    "0xzec",
    "ZEC",
    "fused",
    "42000000",
    1_700_000_100,
    1,
    "",
  );
  await upgraded.run(
    "INSERT INTO external_price_marks(token, symbol, source, usd6, ts, ok, reason) VALUES(?,?,?,?,?,?,?)",
    "0xzec",
    "ZEC",
    "coingecko",
    "41900000",
    1_700_000_100,
    1,
    "",
  );
  const pinned = await upgraded.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
  assert(Number(pinned?.n) === 8, `pinned post-#27 schema is ${pinned?.n}, expected 8`);
  assert(!(await migrationApplied(upgraded, 9)), "pinned v8 has no v9 row");
  assert(!(await migrationApplied(upgraded, 10)), "pinned v8 has no v10 row");
  const preCols = await upgraded.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
  assert(!preCols.some((c) => c.name === "kind"), "pinned v8 production marks have no kind");
  const tokenCols = await upgraded.all<{ name: string }>("PRAGMA table_info(tokens)");
  assert(!tokenCols.some((c) => c.name === "current_supply"), "pinned v8 tokens has no current_supply");

  assert((await applyMigrations(upgraded)) === 10, "real v8 upgrades to v10");
  assert(await migrationApplied(upgraded, 10), "schema_migrations records v10");
  assert(!(await migrationApplied(upgraded, 9)), "v9 left unused for #23 current_supply");
  const cols = await upgraded.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
  assert(cols.some((c) => c.name === "kind"), "v10 adds external_price_marks.kind");
  const fused = await upgraded.get<{ kind: string }>("SELECT kind FROM external_price_marks WHERE source=?", "fused");
  const obs = await upgraded.get<{ kind: string }>("SELECT kind FROM external_price_marks WHERE source=?", "coingecko");
  assert(fused?.kind === "consensus", "legacy fused/consensus/fail/missing backfill to kind=consensus");
  assert(obs?.kind === "observation", "provider rows default to kind=observation");

  // #23 can still fill the reserved v9 slot after this branch lands (existence, not MAX < 9).
  await upgraded.exec("ALTER TABLE tokens ADD COLUMN current_supply TEXT");
  await upgraded.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 9, 1_700_000_000);
  assert(await migrationApplied(upgraded, 9), "v9 remains insertable after v10");
  assert(await migrationApplied(upgraded, 10), "v10 row survives a later v9 insert");
  const afterKind = await upgraded.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
  assert(afterKind.some((c) => c.name === "kind"), "kind column survives a later v9 insert");
  await upgraded.close();
  rmSync(upgradeDir, { recursive: true, force: true });
}

console.log("schema/store tests ok");
