import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "./db.ts";
import { consumeIssuanceToken } from "./admission.ts";
import { raiseAlert } from "./alerts.ts";
import { saveJob } from "./keeper-jobs.ts";
import { recordTrade, upsertMarket, upsertToken } from "./ingest.ts";
import { applyMigrations, migrationApplied, MS_TIMESTAMP_COLUMNS, SCHEMA_VERSION, TABLES } from "./schema.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SCHEMA_VERSION === 11, "schema version 11 adds Top-10 tables after v10 mark kind and v9 current_supply");
assert(MS_TIMESTAMP_COLUMNS.length >= 6, "millisecond timestamp columns listed");

const dir = mkdtempSync(join(tmpdir(), "reactor-prod-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
const migrated = await store.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
assert(Number(migrated?.n) === SCHEMA_VERSION, `sqlite migrates to v${SCHEMA_VERSION}`);

for (const t of TABLES) {
  const row = await store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t);
  assert(row?.name === t, `missing table ${t}`);
}
const markCols = await store.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
assert(markCols.some((c) => c.name === "kind"), "v10 external_price_marks.kind");
const venueCols = await store.all<{ name: string }>("PRAGMA table_info(route_venues)");
assert(
  venueCols.some((c) => c.name === "last_price_quote_x18"),
  "route_venues.last_price_quote_x18 is column-gated (not a new schema_migrations id)",
);

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
const tokenCols = await store.all<{ name: string }>("PRAGMA table_info(tokens)");
assert(tokenCols.some((c) => c.name === "current_supply"), "tokens.current_supply on fresh v11 (from #23 v9)");
const top10Fresh = await store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", "top10_candidate_epochs");
assert(top10Fresh?.name === "top10_candidate_epochs", "v11 adds Top-10 candidate tables on a fresh install");

await upsertToken(store, { address: "0xabc", symbol: "CAT", quote: "0xzec", supply: (10n ** 27n).toString(), ts: 100 });
const seeded = await store.get<{ supply: string; current_supply: string }>(
  "SELECT supply, current_supply FROM tokens WHERE address=?",
  "0xabc",
);
assert(seeded?.supply === (10n ** 27n).toString() && seeded.current_supply === seeded.supply, "current_supply seeded from mint");
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

{
  // Real post-#27 DB: full v8 journal identity, then strip only v9 current_supply.
  const v8dir = mkdtempSync(join(tmpdir(), "reactor-v8-"));
  const v8 = await openStore({ sqlitePath: join(v8dir, "v8.sqlite") });
  const journal = await v8.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='indexer_event_journal'",
  );
  assert(journal?.name === "indexer_event_journal", "post-#27 journal exists before pin");
  const identity = await v8.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_selfburn_identity'",
  );
  assert(identity?.name === "idx_selfburn_identity", "post-#27 identity index exists before pin");
  await v8.exec("ALTER TABLE tokens DROP COLUMN current_supply");
  await v8.exec("DROP TABLE IF EXISTS top10_candidate_rows");
  await v8.exec("DROP TABLE IF EXISTS top10_candidate_epochs");
  await v8.run("DELETE FROM schema_migrations WHERE id >= 9");
  await v8.run(
    `INSERT INTO tokens(address,symbol,name,decimals,creator,quote,mode,rewards_mode,supply,ticker,factory_version,created_block,created_tx,created_ts)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    "0xdead",
    "OLD",
    "Old",
    18,
    "",
    "",
    0,
    1,
    (10n ** 27n).toString(),
    "OLD",
    1,
    0,
    "",
    0,
  );
  const pinned = await v8.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
  assert(Number(pinned?.n) === 8, `pinned post-#27 schema is ${pinned?.n}, expected 8`);
  const preCols = await v8.all<{ name: string }>("PRAGMA table_info(tokens)");
  assert(!preCols.some((c) => c.name === "current_supply"), "pinned v8 tokens has no current_supply");
  const ver = await applyMigrations(v8);
  assert(ver === SCHEMA_VERSION, `v8 DB migrated to ${ver}, expected ${SCHEMA_VERSION}`);
  const cols = await v8.all<{ name: string }>("PRAGMA table_info(tokens)");
  assert(cols.some((c) => c.name === "current_supply"), "v9 adds current_supply onto a real post-#27 tokens table");
  const kindCols = await v8.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
  assert(kindCols.some((c) => c.name === "kind"), "v10 adds external_price_marks.kind onto a real post-#27 DB");
  const top10 = await v8.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", "top10_candidate_epochs");
  assert(top10?.name === "top10_candidate_epochs", "v11 adds Top-10 candidate tables onto a real post-#27 DB");
  const backfilled = await v8.get<{ current_supply: string; supply: string }>(
    "SELECT current_supply, supply FROM tokens WHERE address=?",
    "0xdead",
  );
  assert(backfilled?.current_supply === backfilled?.supply && backfilled?.supply === (10n ** 27n).toString(), "v9 backfills current_supply from supply");
  assert(await migrationApplied(v8, 9) && (await migrationApplied(v8, 10)) && (await migrationApplied(v8, 11)), "v8 upgrade writes v9 then v10 then v11");
  await v8.close();
  rmSync(v8dir, { recursive: true, force: true });
}

rmSync(dir, { recursive: true, force: true });

// Preceding schema after #23 is v9 (current_supply, no kind). Prove unique v10 kind.
{
  const upgradeDir = mkdtempSync(join(tmpdir(), "reactor-v9-"));
  const upgradePath = join(upgradeDir, "v9.sqlite");
  const upgraded = await openStore({ sqlitePath: upgradePath });
  assert((await applyMigrations(upgraded)) === SCHEMA_VERSION, `fresh install reaches v${SCHEMA_VERSION}`);
  await upgraded.exec("ALTER TABLE external_price_marks DROP COLUMN kind");
  await upgraded.exec("DROP TABLE IF EXISTS top10_candidate_rows");
  await upgraded.exec("DROP TABLE IF EXISTS top10_candidate_epochs");
  await upgraded.run("DELETE FROM schema_migrations WHERE id >= 10");
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
  assert(Number(pinned?.n) === 9, `pinned post-#23 schema is ${pinned?.n}, expected 9`);
  assert(await migrationApplied(upgraded, 9), "pinned v9 has current_supply row");
  assert(!(await migrationApplied(upgraded, 10)), "pinned v9 has no v10 row");
  const preCols = await upgraded.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
  assert(!preCols.some((c) => c.name === "kind"), "pinned v9 production marks have no kind");
  const tokenCols = await upgraded.all<{ name: string }>("PRAGMA table_info(tokens)");
  assert(tokenCols.some((c) => c.name === "current_supply"), "pinned v9 tokens keeps current_supply");

  assert((await applyMigrations(upgraded)) === SCHEMA_VERSION, "real v9 upgrades through v10 kind to v11 Top-10");
  assert(await migrationApplied(upgraded, 9), "v9 current_supply row remains");
  assert(await migrationApplied(upgraded, 10), "schema_migrations records v10");
  assert(await migrationApplied(upgraded, 11), "schema_migrations records v11");
  const cols = await upgraded.all<{ name: string }>("PRAGMA table_info(external_price_marks)");
  assert(cols.some((c) => c.name === "kind"), "v10 adds external_price_marks.kind");
  const fused = await upgraded.get<{ kind: string }>("SELECT kind FROM external_price_marks WHERE source=?", "fused");
  const obs = await upgraded.get<{ kind: string }>("SELECT kind FROM external_price_marks WHERE source=?", "coingecko");
  assert(fused?.kind === "consensus", "legacy fused/consensus/fail/missing backfill to kind=consensus");
  assert(obs?.kind === "observation", "provider rows default to kind=observation");
  const top10 = await upgraded.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", "top10_candidate_epochs");
  assert(top10?.name === "top10_candidate_epochs", "v11 adds Top-10 tables onto a real post-#23 v9 DB");
  await upgraded.close();
  rmSync(upgradeDir, { recursive: true, force: true });
}

// Already-at-v10 DB missing the venue mark column: add the column (not a schema id) and unique v11 Top-10 tables.
{
  const colDir = mkdtempSync(join(tmpdir(), "reactor-v10-venue-"));
  const colPath = join(colDir, "v10.sqlite");
  const seed = new DatabaseSync(colPath);
  seed.exec(`
    CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_ts INTEGER NOT NULL);
    CREATE TABLE route_venues (
      id TEXT PRIMARY KEY, token_in TEXT, token_out TEXT, adapter TEXT, kind TEXT, data TEXT, pool_id TEXT,
      exists_onchain INTEGER, approved INTEGER, reliability_bps INTEGER
    );
    CREATE TABLE external_price_marks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT, symbol TEXT, source TEXT, usd6 TEXT, ts INTEGER, ok INTEGER, reason TEXT, kind TEXT DEFAULT 'observation'
    );
  `);
  const insertMig = seed.prepare("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)");
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 10]) insertMig.run(id, 1_700_000_000);
  const before = seed.prepare("PRAGMA table_info(route_venues)").all() as Array<{ name: string }>;
  assert(!before.some((c) => c.name === "last_price_quote_x18"), "pre-column v10 venue table");
  seed.close();

  const patched = await openStore({ sqlitePath: colPath });
  assert((await applyMigrations(patched)) === SCHEMA_VERSION, "v10 DB migrates to unique v11 Top-10 tables");
  assert(await migrationApplied(patched, 9), "existence apply fills #23 v9 if missing");
  assert(await migrationApplied(patched, 10), "v10 kind row remains");
  assert(await migrationApplied(patched, 11), "v11 Top-10 snapshot tables");
  const extra = await patched.get<{ n: number }>("SELECT COUNT(*) as n FROM schema_migrations WHERE id>11");
  assert(Number(extra?.n) === 0, "did not invent v12");
  const cols = await patched.all<{ name: string }>("PRAGMA table_info(route_venues)");
  assert(cols.some((c) => c.name === "last_price_quote_x18"), "column-gated last_price_quote_x18");
  const top10 = await patched.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", "top10_candidate_epochs");
  assert(top10?.name === "top10_candidate_epochs", "v11 Top-10 tables land after a #30-only v10");
  await patched.close();
  rmSync(colDir, { recursive: true, force: true });
}

console.log("schema/store tests ok");
