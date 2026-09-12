import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import { consumeIssuanceToken } from "./admission.ts";
import { raiseAlert } from "./alerts.ts";
import { saveJob } from "./keeper-jobs.ts";
import { recordTrade, upsertMarket, upsertToken } from "./ingest.ts";
import { applyMigrations, MS_TIMESTAMP_COLUMNS, SCHEMA_VERSION, TABLES } from "./schema.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SCHEMA_VERSION === 10, "schema version 10 adds Top-10 candidate tables after v9 current_supply");
assert(MS_TIMESTAMP_COLUMNS.length >= 6, "millisecond timestamp columns listed");

const dir = mkdtempSync(join(tmpdir(), "reactor-prod-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
const migrated = await store.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
assert(Number(migrated?.n) === SCHEMA_VERSION, `sqlite migrates to v${SCHEMA_VERSION}`);

for (const t of TABLES) {
  const row = await store.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t);
  assert(row?.name === t, `missing table ${t}`);
}

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
assert(tokenCols.some((c) => c.name === "current_supply"), "tokens.current_supply on fresh v9");

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
  const top10 = await v8.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", "top10_candidate_epochs");
  assert(top10?.name === "top10_candidate_epochs", "v10 adds Top-10 candidate tables onto a real post-#27 DB");
  const backfilled = await v8.get<{ current_supply: string; supply: string }>(
    "SELECT current_supply, supply FROM tokens WHERE address=?",
    "0xdead",
  );
  assert(backfilled?.current_supply === backfilled?.supply && backfilled?.supply === (10n ** 27n).toString(), "v9 backfills current_supply from supply");
  await v8.close();
  rmSync(v8dir, { recursive: true, force: true });
}

rmSync(dir, { recursive: true, force: true });
console.log("schema/store tests ok");
