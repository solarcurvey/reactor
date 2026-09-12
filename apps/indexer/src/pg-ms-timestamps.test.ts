/**
 * Real Postgres: millisecond Date.now() (~1.8e12) must persist.
 * Postgres INTEGER is 32-bit (max 2_147_483_647). SQLite INTEGER is 64-bit, so
 * local tests hide this. Requires DATABASE_URL=postgres://…
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg
 */
import pg from "pg";
import { openStore } from "./db.ts";
import { admit, consumeIssuanceToken, consumeReceipt, issueReceipt, persistReceipt } from "./admission.ts";
import { raiseAlert } from "./alerts.ts";
import { saveJob, withLeaderLock } from "./keeper-jobs.ts";
import { applyMigrations, migrationApplied, MS_TIMESTAMP_COLUMNS, SCHEMA_VERSION } from "./migrations.ts";
import { TABLES } from "./schema.ts";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("postgres")) {
  console.error("DATABASE_URL must be postgres://… — this test is real Postgres only");
  process.exit(2);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const INT32_MAX = 2_147_483_647;
const nowMs = Date.now();
assert(nowMs > INT32_MAX, `Date.now() ${nowMs} should exceed 32-bit INTEGER`);

async function resetPublic(client: pg.PoolClient) {
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("GRANT ALL ON SCHEMA public TO public");
}

async function columnType(client: pg.PoolClient, table: string, column: string): Promise<string> {
  const r = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rows[0]?.data_type ?? "";
}

async function assertMsColumnsBigint(client: pg.PoolClient) {
  for (const { table, column } of MS_TIMESTAMP_COLUMNS) {
    const t = await columnType(client, table, column);
    assert(t === "bigint", `${table}.${column} expected bigint, got ${t || "missing"}`);
  }
}

const pool = new pg.Pool({ connectionString: url, max: 4 });
const admin = await pool.connect();

try {
  // --- V5 INTEGER schema: prove overflow, migrate, no data loss ---
  await resetPublic(admin);
  await admin.query(`
    CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_ts BIGINT NOT NULL);
    CREATE TABLE admission_hits (
      id BIGSERIAL PRIMARY KEY, key TEXT NOT NULL, ts INTEGER NOT NULL
    );
    CREATE TABLE issuance_bucket (
      k TEXT PRIMARY KEY, tokens TEXT NOT NULL, updated_ms INTEGER NOT NULL, signed_count INTEGER NOT NULL
    );
    CREATE TABLE leader_locks (
      name TEXT PRIMARY KEY, owner TEXT, ts INTEGER, lease_until INTEGER
    );
    CREATE TABLE keeper_operations (
      id TEXT PRIMARY KEY, kind TEXT, status TEXT, hash TEXT, nonce TEXT, receipt TEXT, note TEXT,
      request_id TEXT, op_id TEXT, ts INTEGER
    );
    CREATE TABLE alerts (
      id BIGSERIAL PRIMARY KEY, level TEXT, code TEXT, detail TEXT, ts INTEGER
    );
    INSERT INTO schema_migrations(id, applied_ts) VALUES (5, 1_700_000_000);
    INSERT INTO admission_hits(key, ts) VALUES ('legacy:hit', 1_700_000_000);
    INSERT INTO issuance_bucket(k, tokens, updated_ms, signed_count) VALUES ('global', '99', 1_700_000_111, 7);
    INSERT INTO leader_locks(name, owner, ts, lease_until) VALUES ('legacy-lock', 'alice', 1_700_000_222, 1_700_000_333);
    INSERT INTO keeper_operations(id, kind, status, hash, nonce, receipt, note, request_id, op_id, ts)
      VALUES ('legacy-job', 'keeper', 'done', '', '', '', 'seed', '', 'legacy-job', 1_700_000_444);
    INSERT INTO alerts(level, code, detail, ts) VALUES ('warn', 'LEGACY', 'seed', 1_700_000_555);
  `);

  const overflowInserts: Array<{ label: string; sql: string; args: unknown[] }> = [
    { label: "admission_hits.ts", sql: "INSERT INTO admission_hits(key, ts) VALUES ($1, $2)", args: ["overflow", nowMs] },
    {
      label: "issuance_bucket.updated_ms",
      sql: "INSERT INTO issuance_bucket(k, tokens, updated_ms, signed_count) VALUES ($1,$2,$3,$4)",
      args: ["overflow", "1", nowMs, 0],
    },
    {
      label: "leader_locks.ts/lease_until",
      sql: "INSERT INTO leader_locks(name, owner, ts, lease_until) VALUES ($1,$2,$3,$4)",
      args: ["overflow-lock", "x", nowMs, nowMs + 45_000],
    },
    {
      label: "keeper_operations.ts",
      sql: "INSERT INTO keeper_operations(id,kind,status,hash,nonce,receipt,note,request_id,op_id,ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      args: ["overflow-job", "keeper", "done", "", "", "", "", "", "overflow-job", nowMs],
    },
    {
      label: "alerts.ts",
      sql: "INSERT INTO alerts(level, code, detail, ts) VALUES ($1,$2,$3,$4)",
      args: ["P0", "OVERFLOW", "v5", nowMs],
    },
  ];
  for (const ins of overflowInserts) {
    let overflowed = false;
    try {
      await admin.query(ins.sql, ins.args);
    } catch (e) {
      overflowed = /out of range|integer/i.test(String(e));
    }
    assert(overflowed, `V5 INTEGER ${ins.label} must reject Date.now()`);
  }

  const storeV5 = await openStore({ databaseUrl: url });
  assert(storeV5.dialect === "postgres", "dialect");
  const ver = await applyMigrations(storeV5);
  assert(ver === SCHEMA_VERSION, `migrated to ${ver}, expected ${SCHEMA_VERSION}`);
  await storeV5.close();

  await assertMsColumnsBigint(admin);

  const preserved = await admin.query<{
    hits: string;
    tokens: string;
    updated_ms: string;
    signed_count: number;
    lock_ts: string;
    lease_until: string;
    job_ts: string;
    alert_ts: string;
  }>(`
    SELECT
      (SELECT ts::text FROM admission_hits WHERE key='legacy:hit') AS hits,
      (SELECT tokens FROM issuance_bucket WHERE k='global') AS tokens,
      (SELECT updated_ms::text FROM issuance_bucket WHERE k='global') AS updated_ms,
      (SELECT signed_count FROM issuance_bucket WHERE k='global') AS signed_count,
      (SELECT ts::text FROM leader_locks WHERE name='legacy-lock') AS lock_ts,
      (SELECT lease_until::text FROM leader_locks WHERE name='legacy-lock') AS lease_until,
      (SELECT ts::text FROM keeper_operations WHERE id='legacy-job') AS job_ts,
      (SELECT ts::text FROM alerts WHERE code='LEGACY') AS alert_ts
  `);
  const row = preserved.rows[0];
  assert(row.hits === "1700000000", `admission_hits preserved, got ${row.hits}`);
  assert(row.tokens === "99" && Number(row.signed_count) === 7, "issuance_bucket tokens/count preserved");
  assert(row.updated_ms === "1700000111", `issuance_bucket.updated_ms preserved, got ${row.updated_ms}`);
  assert(row.lock_ts === "1700000222" && row.lease_until === "1700000333", "leader_locks preserved");
  assert(row.job_ts === "1700000444", "keeper_operations.ts preserved");
  assert(row.alert_ts === "1700000555", "alerts.ts preserved");

  // --- Real post-#27 v8: journal identity, no v9/v10. Upgrade writes #23 v9 then kind v10. ---
  await resetPublic(admin);
  const storeV8 = await openStore({ databaseUrl: url });
  assert((await applyMigrations(storeV8)) === SCHEMA_VERSION, "fresh install reaches SCHEMA_VERSION");
  const journal = await admin.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='indexer_event_journal'",
  );
  assert(journal.rows[0]?.n === "1", "post-#27 journal exists before pin");
  await admin.query("ALTER TABLE external_price_marks DROP COLUMN IF EXISTS kind");
  await admin.query("ALTER TABLE tokens DROP COLUMN IF EXISTS current_supply");
  await admin.query("DELETE FROM schema_migrations WHERE id >= 9");
  await admin.query(`
    INSERT INTO external_price_marks(token, symbol, source, usd6, ts, ok, reason)
      VALUES ('0xzec', 'ZEC', 'fused', '42000000', 1700000100, 1, ''),
             ('0xzec', 'ZEC', 'coingecko', '41900000', 1700000100, 1, '');
    INSERT INTO tokens(address,symbol,name,decimals,creator,quote,mode,rewards_mode,supply,ticker,factory_version,created_block,created_tx,created_ts)
      VALUES ('0xdead','OLD','Old',18,'','',0,1,'1000000000000000000000000000','OLD',1,0,'',0);
  `);
  const pinned = await admin.query<{ n: string }>("SELECT COALESCE(MAX(id),0)::text AS n FROM schema_migrations");
  assert(pinned.rows[0]?.n === "8", `pinned post-#27 schema is ${pinned.rows[0]?.n}, expected 8`);
  assert(!(await migrationApplied(storeV8, 9)), "pinned v8 has no v9 row");
  assert(!(await migrationApplied(storeV8, 10)), "pinned v8 has no v10 row");
  assert((await applyMigrations(storeV8)) === SCHEMA_VERSION, `real v8 upgrades to v${SCHEMA_VERSION}`);
  assert(await migrationApplied(storeV8, 9), "v8 upgrade writes #23 v9 current_supply");
  assert(await migrationApplied(storeV8, 10), "v8 upgrade writes v10 kind after v9");
  const kindCol = await admin.query<{ data_type: string }>(
    "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='external_price_marks' AND column_name='kind'",
  );
  assert(kindCol.rows[0]?.data_type === "text", "v10 adds external_price_marks.kind");
  const v8col = await columnType(admin, "tokens", "current_supply");
  assert(v8col === "text", `v9 adds tokens.current_supply onto a real post-#27 DB, got ${v8col || "missing"}`);
  const kinds = await admin.query<{ source: string; kind: string }>(
    "SELECT source, kind FROM external_price_marks ORDER BY source",
  );
  const bySource = Object.fromEntries(kinds.rows.map((r) => [r.source, r.kind]));
  assert(bySource.fused === "consensus", "legacy fused backfills to kind=consensus");
  assert(bySource.coingecko === "observation", "provider rows default to kind=observation");
  await storeV8.close();

  // --- Preceding schema after #23 is v9. Prove unique v10 kind. ---
  await resetPublic(admin);
  const storeV9 = await openStore({ databaseUrl: url });
  assert((await applyMigrations(storeV9)) === SCHEMA_VERSION, "boot to stack tip");
  await admin.query("ALTER TABLE external_price_marks DROP COLUMN IF EXISTS kind");
  await admin.query("DELETE FROM schema_migrations WHERE id >= 10");
  await admin.query(`
    INSERT INTO external_price_marks(token, symbol, source, usd6, ts, ok, reason)
      VALUES ('0xzec', 'ZEC', 'fused', '42000000', 1700000100, 1, '');
  `);
  assert(await migrationApplied(storeV9, 9), "pinned v9 has current_supply");
  assert(!(await migrationApplied(storeV9, 10)), "pinned v9 has no kind migration");
  assert((await applyMigrations(storeV9)) === 10, "real v9 upgrades to v10");
  assert(await migrationApplied(storeV9, 9), "v9 row remains");
  assert(await migrationApplied(storeV9, 10), "v10 written after #23");
  await storeV9.close();

  // --- Fresh schema + live Date.now() paths ---
  await resetPublic(admin);
  const store = await openStore({ databaseUrl: url });
  assert(store.dialect === "postgres", "fresh dialect");
  assert((await applyMigrations(store)) === SCHEMA_VERSION, `fresh schema is v${SCHEMA_VERSION}`);
  const venueMark = await admin.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM information_schema.columns
     WHERE table_schema='public' AND table_name='route_venues' AND column_name='last_price_quote_x18'`,
  );
  assert(venueMark.rows[0]?.n === "1", "route_venues.last_price_quote_x18 present without claiming a new schema version");
  const supplyCol = await columnType(admin, "tokens", "current_supply");
  assert(supplyCol === "text", `tokens.current_supply expected text, got ${supplyCol || "missing"}`);

  for (const t of TABLES) {
    const exists = await store.get<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=?) AS exists",
      t,
    );
    assert(exists?.exists, `missing ${t}`);
  }
  await assertMsColumnsBigint(admin);

  process.env.REACTOR_ENV = "LOCAL";
  process.env.ADMISSION_HMAC_SECRET = "test-admission-hmac-secret-pg";
  delete process.env.TURNSTILE_SECRET;
  delete process.env.TURNSTILE_REQUIRED;
  delete process.env.REDIS_URL;

  const admitted = await admit(store, {
    ticker: "PGBIG",
    quote: "0x0000000000000000000000000000000000000001",
    name: "Pg Bigint",
    wallet: "0x1111111111111111111111111111111111111111",
    ip: "203.0.113.9",
    factory: "0x0000000000000000000000000000000000000002",
    mode: "rewards",
  });
  assert(admitted.decision === "ALLOW" && admitted.receipt, `admit ${admitted.decision} ${admitted.reasons}`);

  const hit = await store.get<{ ts: string | number }>(
    "SELECT ts FROM admission_hits WHERE key=? ORDER BY ts DESC LIMIT 1",
    "ip:203.0.113.9",
  );
  assert(Number(hit?.ts) > INT32_MAX, `admission_hits.ts=${hit?.ts} must be Date.now() ms`);

  // Store prelude of signAuthorized: atomic receipt consume + signed-auth bucket.
  const receipt = issueReceipt({
    decision: "ALLOW",
    ticker: "PGBIG",
    creator: "0x1111111111111111111111111111111111111111",
    quote: "0x0000000000000000000000000000000000000001",
  });
  await persistReceipt(store, receipt, { ticker: "PGBIG" }, Math.floor(Date.now() / 1000) + 300);
  const consumed = await consumeReceipt(store, receipt.id);
  assert(consumed, "LaunchAuthorization receipt consumed once");
  const issued = await consumeIssuanceToken(store);
  assert(issued.ok, "LaunchAuthorization issuance token consumed");
  const replay = await consumeReceipt(store, receipt.id);
  assert(!replay, "consumed receipt cannot be reused");
  const bucket = await store.get<{ updated_ms: string | number; signed_count: number }>(
    "SELECT updated_ms, signed_count FROM issuance_bucket WHERE k=?",
    "global",
  );
  assert(Number(bucket?.updated_ms) > INT32_MAX, `issuance_bucket.updated_ms=${bucket?.updated_ms}`);
  assert(Number(bucket?.signed_count) >= 1, "signed_count incremented");

  const leader = await withLeaderLock(store, "keeper-a", async () => {
    const blocked = await store.tryAdvisoryLock("reactor-keeper", "keeper-b", 45_000);
    assert(!blocked, "follower blocked while lease is live");
    return "held";
  });
  assert(leader === "held", "Keeper leadership acquired");
  // withLeaderLock releases; re-acquire to inspect persisted millisecond values
  const relocked = await store.tryAdvisoryLock("reactor-keeper", "keeper-a", 45_000);
  assert(relocked, "leadership re-acquire");
  const lock = await store.get<{ ts: string | number; lease_until: string | number }>(
    "SELECT ts, lease_until FROM leader_locks WHERE name=?",
    "reactor-keeper",
  );
  assert(Number(lock?.ts) > INT32_MAX, `leader_locks.ts=${lock?.ts}`);
  assert(Number(lock?.lease_until) > INT32_MAX, `leader_locks.lease_until=${lock?.lease_until}`);
  await store.releaseLock("reactor-keeper", "keeper-a");

  const jobNow = Date.now();
  await saveJob(store, "settle:pg-ms", { status: "done", ts: jobNow, note: "bigint" }, "MAINTENANCE_SETTLEMENT");
  const job = await store.get<{ ts: string | number; kind: string }>(
    "SELECT ts, kind FROM keeper_operations WHERE id=?",
    "settle:pg-ms",
  );
  assert(job?.kind === "MAINTENANCE_SETTLEMENT", "job kind");
  assert(Number(job?.ts) === jobNow, `keeper_operations.ts=${job?.ts} !== ${jobNow}`);

  await raiseAlert(store, "P0", "PG_MS", "Date.now() alert");
  const alert = await store.get<{ ts: string | number }>("SELECT ts FROM alerts WHERE code=?", "PG_MS");
  assert(Number(alert?.ts) > INT32_MAX, `alerts.ts=${alert?.ts}`);

  await store.close();
  console.log("postgres millisecond BIGINT tests ok");
} finally {
  admin.release();
  await pool.end();
}
