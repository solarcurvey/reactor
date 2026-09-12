import type { Store } from "./db.ts";

export const SCHEMA_VERSION = 11;

/**
 * Wall-clock fields written as `Date.now()` milliseconds (≈1.8e12 today).
 * Postgres INTEGER is 32-bit (max 2_147_483_647) and overflows; BIGINT is required.
 * SQLite INTEGER is already 64-bit — the V6 ALTER is a Postgres-only type promotion.
 *
 * Unix-seconds fields (`Math.floor(Date.now() / 1000)`, chain `block.timestamp`,
 * ticker `locked_until`, receipt `expires`) stay INTEGER until 2038.
 */
export const MS_TIMESTAMP_COLUMNS = [
  { table: "admission_hits", column: "ts" },
  { table: "issuance_bucket", column: "updated_ms" },
  { table: "leader_locks", column: "ts" },
  { table: "leader_locks", column: "lease_until" },
  { table: "keeper_operations", column: "ts" },
  { table: "alerts", column: "ts" },
] as const;

const V1_TABLES = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  applied_ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS indexer_state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  address TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  decimals INTEGER,
  creator TEXT,
  quote TEXT,
  mode INTEGER,
  rewards_mode INTEGER,
  supply TEXT,
  current_supply TEXT,
  ticker TEXT,
  factory_version INTEGER,
  created_block INTEGER,
  created_tx TEXT,
  created_ts INTEGER
);
CREATE TABLE IF NOT EXISTS markets (
  token TEXT PRIMARY KEY,
  quote TEXT,
  pool_id TEXT,
  stage TEXT,
  market_live INTEGER,
  fair_id TEXT,
  bonding_bps INTEGER,
  real_quote TEXT,
  grad_target TEXT,
  price_quote_x18 TEXT,
  price_usd6 TEXT,
  fdv_usd6 TEXT,
  volume_24h_quote TEXT,
  volume_24h_usd6 TEXT,
  trades_24h INTEGER,
  lifetime_rewards TEXT,
  image TEXT,
  description TEXT,
  updated_ts INTEGER
);
CREATE TABLE IF NOT EXISTS quote_assets (
  token TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  decimals INTEGER,
  category INTEGER,
  enabled INTEGER,
  usd_peg_one INTEGER,
  hop_via_usdc INTEGER,
  reactor_native INTEGER,
  parent_quote TEXT,
  quarantined INTEGER
);
CREATE TABLE IF NOT EXISTS pool_relationships (
  pool_id TEXT PRIMARY KEY,
  token TEXT,
  quote TEXT,
  venue TEXT,
  fee INTEGER,
  hooks TEXT,
  exists_onchain INTEGER,
  approved INTEGER,
  created_block INTEGER
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER,
  block INTEGER,
  tx TEXT,
  log_index INTEGER,
  token TEXT,
  quote TEXT,
  side TEXT,
  source TEXT,
  amount_in TEXT,
  amount_out TEXT,
  notional_quote TEXT,
  price_quote_x18 TEXT,
  sqrt_price TEXT,
  holders_fee TEXT,
  flywheel_fee TEXT,
  core_fee TEXT,
  ts INTEGER,
  UNIQUE(chain_id, tx, log_index)
);
CREATE TABLE IF NOT EXISTS candles (
  token TEXT NOT NULL,
  interval_sec INTEGER NOT NULL,
  t INTEGER NOT NULL,
  o TEXT, h TEXT, l TEXT, c TEXT,
  v TEXT,
  n INTEGER,
  PRIMARY KEY (token, interval_sec, t)
);
CREATE TABLE IF NOT EXISTS bonding_states (
  token TEXT PRIMARY KEY,
  real_quote TEXT,
  grad_target TEXT,
  inventory TEXT,
  ready INTEGER,
  graduated INTEGER,
  bonding_bps INTEGER,
  updated_ts INTEGER
);
CREATE TABLE IF NOT EXISTS graduations (
  token TEXT PRIMARY KEY,
  pool_id TEXT,
  quote_lp TEXT,
  token_lp TEXT,
  block INTEGER,
  tx TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS reward_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT, amount TEXT, block INTEGER, tx TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT, account TEXT, amount TEXT, block INTEGER, tx TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS selfburn (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT, quote TEXT, amount TEXT, burned TEXT, kind TEXT, block INTEGER, tx TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS flywheel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote TEXT, amount TEXT, usdc_in TEXT, kind TEXT, block INTEGER, tx TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS core_buybacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote TEXT, quote_in TEXT, core_out TEXT, block INTEGER, tx TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS top10_epochs (
  epoch_id TEXT PRIMARY KEY, pot TEXT, n INTEGER, finalized INTEGER, paused INTEGER, reason TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS top10_candidate_epochs (
  id TEXT PRIMARY KEY,
  computed_ts INTEGER NOT NULL,
  now_sec INTEGER NOT NULL,
  pause_epoch INTEGER NOT NULL,
  reason TEXT,
  candidates INTEGER,
  source TEXT,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS top10_candidate_rows (
  epoch_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  token TEXT,
  symbol TEXT,
  quote TEXT,
  mark_usdc TEXT,
  weight_bps INTEGER,
  PRIMARY KEY (epoch_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_top10_candidate_token ON top10_candidate_rows(token);
CREATE TABLE IF NOT EXISTS targets (
  epoch_id TEXT, rank INTEGER, token TEXT, weight_bps INTEGER, mark_usdc TEXT, PRIMARY KEY (epoch_id, rank)
);
CREATE TABLE IF NOT EXISTS keeper_operations (
  id TEXT PRIMARY KEY, kind TEXT, status TEXT, hash TEXT, nonce TEXT, receipt TEXT, note TEXT, request_id TEXT, op_id TEXT, ts BIGINT
);
CREATE TABLE IF NOT EXISTS guardian_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, payload TEXT, block INTEGER, tx TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS route_venues (
  id TEXT PRIMARY KEY, token_in TEXT, token_out TEXT, adapter TEXT, kind TEXT, data TEXT, pool_id TEXT,
  exists_onchain INTEGER, approved INTEGER, reliability_bps INTEGER, last_price_quote_x18 TEXT
);
CREATE TABLE IF NOT EXISTS external_price_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT, symbol TEXT, source TEXT, usd6 TEXT, ts INTEGER, ok INTEGER, reason TEXT, kind TEXT DEFAULT 'observation'
);
CREATE TABLE IF NOT EXISTS metadata (
  token TEXT PRIMARY KEY, image TEXT, description TEXT, website TEXT, twitter TEXT, telegram TEXT, media_id TEXT
);
CREATE TABLE IF NOT EXISTS leader_locks (
  name TEXT PRIMARY KEY, owner TEXT, ts BIGINT, lease_until BIGINT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, code TEXT, detail TEXT, ts BIGINT
);
CREATE TABLE IF NOT EXISTS tickers (
  ticker TEXT PRIMARY KEY,
  token TEXT,
  factory TEXT,
  factory_version INTEGER,
  locked_until INTEGER,
  permanent INTEGER,
  reserved INTEGER
);
CREATE TABLE IF NOT EXISTS launch_auths (
  digest TEXT PRIMARY KEY,
  auth_id TEXT,
  creator TEXT,
  ticker TEXT,
  quote TEXT,
  factory TEXT,
  decision TEXT,
  ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trades_token_ts ON trades(token, ts);
CREATE INDEX IF NOT EXISTS idx_trades_id ON trades(chain_id, tx, log_index);
CREATE INDEX IF NOT EXISTS idx_candles_token ON candles(token, interval_sec, t);
CREATE INDEX IF NOT EXISTS idx_markets_stage ON markets(stage);
CREATE INDEX IF NOT EXISTS idx_markets_quote ON markets(quote);
CREATE INDEX IF NOT EXISTS idx_markets_updated ON markets(updated_ts);
CREATE INDEX IF NOT EXISTS idx_tokens_ticker ON tokens(ticker);
CREATE INDEX IF NOT EXISTS idx_keeper_status ON keeper_operations(status, ts);
CREATE INDEX IF NOT EXISTS idx_venues_pair ON route_venues(token_in, token_out);
`;

const V4_TABLES = `
CREATE TABLE IF NOT EXISTS admission_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admission_hits_key_ts ON admission_hits(key, ts);
CREATE TABLE IF NOT EXISTS admission_challenges (
  id TEXT PRIMARY KEY,
  wallet TEXT,
  session TEXT,
  ip TEXT,
  ticker TEXT,
  status TEXT,
  created_ts INTEGER,
  solved_ts INTEGER
);
CREATE TABLE IF NOT EXISTS admission_image_hashes (
  hash TEXT PRIMARY KEY,
  first_seen INTEGER,
  count INTEGER
);
CREATE TABLE IF NOT EXISTS issuance_state (
  k TEXT PRIMARY KEY,
  v TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS admission_receipts (
  id TEXT PRIMARY KEY,
  hmac TEXT,
  payload TEXT,
  consumed INTEGER,
  expires INTEGER,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS official_pools (
  pool_id TEXT PRIMARY KEY,
  token TEXT,
  quote TEXT,
  factory TEXT,
  mode INTEGER,
  hook TEXT,
  block INTEGER,
  tx TEXT,
  ts INTEGER
);
`;

export async function applyMigrations(store: Store): Promise<number> {
  await store.exec(
    store.dialect === "postgres"
      ? `CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_ts BIGINT NOT NULL)`
      : `CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_ts INTEGER NOT NULL)`,
  );
  const row = await store.get<{ n: number }>("SELECT COALESCE(MAX(id),0) as n FROM schema_migrations");
  let current = Number(row?.n ?? 0);
  if (current === 0) {
    const existing = await store.get<{ n: number }>("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='tokens'").catch(() => undefined);
    const sql = store.dialect === "postgres" ? postgres(V1_TABLES) : V1_TABLES;
    await store.exec(sql);
    if (!existing || Number(existing.n) === 0 || current === 0) {
      await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 1, Math.floor(Date.now() / 1000));
      current = 1;
    }
  }
  if (current < 2) {
    for (const stmt of [
      "ALTER TABLE tokens ADD COLUMN ticker TEXT",
      "ALTER TABLE tokens ADD COLUMN factory_version INTEGER",
      "ALTER TABLE trades ADD COLUMN chain_id INTEGER",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 2, Math.floor(Date.now() / 1000));
    current = 2;
  }
  if (current < 3) {
    await store.exec(
      `CREATE TABLE IF NOT EXISTS tickers (
        ticker TEXT PRIMARY KEY, token TEXT, factory TEXT, factory_version INTEGER,
        locked_until INTEGER, permanent INTEGER, reserved INTEGER
      )`,
    );
    await store.exec(
      `CREATE TABLE IF NOT EXISTS launch_auths (
        digest TEXT PRIMARY KEY, auth_id TEXT, creator TEXT, ticker TEXT, quote TEXT, factory TEXT, decision TEXT, ts INTEGER
      )`,
    );
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 3, Math.floor(Date.now() / 1000));
    current = 3;
  }
  if (current < 4) {
    const ddl = store.dialect === "postgres"
      ? postgres(V4_TABLES)
      : V4_TABLES;
    await store.exec(ddl);
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 4, Math.floor(Date.now() / 1000));
    current = 4;
  }
  if (current < 5) {
    await store.exec(`
      CREATE TABLE IF NOT EXISTS issuance_bucket (
        k TEXT PRIMARY KEY,
        tokens TEXT NOT NULL,
        updated_ms BIGINT NOT NULL,
        signed_count INTEGER NOT NULL
      );
    `);
    for (const stmt of [
      "ALTER TABLE trades ADD COLUMN rolled INTEGER DEFAULT 0",
      "ALTER TABLE trades ADD COLUMN notional_usd6 TEXT DEFAULT '0'",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_unique ON claims(tx, token, account, amount)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_selfburn_unique ON selfburn(tx, token, kind)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_flywheel_unique ON flywheel(tx, quote, kind)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_core_buybacks_unique ON core_buybacks(tx, quote)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_events_unique ON reward_events(tx, token, amount)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_external_marks_unique ON external_price_marks(token, source, ts)",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 5, Math.floor(Date.now() / 1000));
    current = 5;
  }
  if (current < 6) {
    if (store.dialect === "postgres") {
      for (const { table, column } of MS_TIMESTAMP_COLUMNS) {
        await store.exec(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE BIGINT`);
      }
    }
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 6, Math.floor(Date.now() / 1000));
    current = 6;
  }
  if (current < 7) {
    for (const stmt of [
      "ALTER TABLE claims ADD COLUMN chain_id INTEGER DEFAULT 0",
      "ALTER TABLE claims ADD COLUMN log_index INTEGER DEFAULT 0",
      "ALTER TABLE selfburn ADD COLUMN chain_id INTEGER DEFAULT 0",
      "ALTER TABLE selfburn ADD COLUMN log_index INTEGER DEFAULT 0",
      "ALTER TABLE flywheel ADD COLUMN chain_id INTEGER DEFAULT 0",
      "ALTER TABLE flywheel ADD COLUMN log_index INTEGER DEFAULT 0",
      "ALTER TABLE core_buybacks ADD COLUMN chain_id INTEGER DEFAULT 0",
      "ALTER TABLE core_buybacks ADD COLUMN log_index INTEGER DEFAULT 0",
      "ALTER TABLE reward_events ADD COLUMN chain_id INTEGER DEFAULT 0",
      "ALTER TABLE reward_events ADD COLUMN log_index INTEGER DEFAULT 0",
      "ALTER TABLE guardian_events ADD COLUMN chain_id INTEGER DEFAULT 0",
      "ALTER TABLE guardian_events ADD COLUMN log_index INTEGER DEFAULT 0",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    for (const stmt of [
      "UPDATE claims SET log_index = id WHERE COALESCE(log_index,0)=0",
      "UPDATE selfburn SET log_index = id WHERE COALESCE(log_index,0)=0",
      "UPDATE flywheel SET log_index = id WHERE COALESCE(log_index,0)=0",
      "UPDATE core_buybacks SET log_index = id WHERE COALESCE(log_index,0)=0",
      "UPDATE reward_events SET log_index = id WHERE COALESCE(log_index,0)=0",
      "UPDATE guardian_events SET log_index = id WHERE COALESCE(log_index,0)=0",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    for (const stmt of [
      "DROP INDEX IF EXISTS idx_claims_unique",
      "DROP INDEX IF EXISTS idx_selfburn_unique",
      "DROP INDEX IF EXISTS idx_flywheel_unique",
      "DROP INDEX IF EXISTS idx_core_buybacks_unique",
      "DROP INDEX IF EXISTS idx_reward_events_unique",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    for (const stmt of [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_log ON claims(chain_id, tx, log_index)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_selfburn_log ON selfburn(chain_id, tx, log_index)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_flywheel_log ON flywheel(chain_id, tx, log_index)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_core_buybacks_log ON core_buybacks(chain_id, tx, log_index)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_events_log ON reward_events(chain_id, tx, log_index)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_events_log ON guardian_events(chain_id, tx, log_index)",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 7, Math.floor(Date.now() / 1000));
    current = 7;
  }
  if (current < 8) {
    await store.exec(`
      CREATE TABLE IF NOT EXISTS indexer_event_journal (
        chain_id INTEGER NOT NULL,
        tx TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        event_kind TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        block INTEGER,
        ts INTEGER,
        PRIMARY KEY (chain_id, tx, log_index, event_kind)
      );
    `);
    await store.exec("CREATE INDEX IF NOT EXISTS idx_event_journal_tx ON indexer_event_journal(tx, log_index)").catch(() => undefined);
    for (const stmt of [
      "ALTER TABLE claims ADD COLUMN event_kind TEXT DEFAULT ''",
      "ALTER TABLE selfburn ADD COLUMN event_kind TEXT DEFAULT ''",
      "ALTER TABLE flywheel ADD COLUMN event_kind TEXT DEFAULT ''",
      "ALTER TABLE core_buybacks ADD COLUMN event_kind TEXT DEFAULT ''",
      "ALTER TABLE reward_events ADD COLUMN event_kind TEXT DEFAULT ''",
      "ALTER TABLE guardian_events ADD COLUMN event_kind TEXT DEFAULT ''",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    for (const stmt of [
      "UPDATE claims SET event_kind = 'RewardClaimed' WHERE COALESCE(event_kind,'') = ''",
      "UPDATE selfburn SET event_kind = COALESCE(NULLIF(kind,''), 'SelfBurn') WHERE COALESCE(event_kind,'') = ''",
      "UPDATE flywheel SET event_kind = COALESCE(NULLIF(kind,''), 'Flywheel') WHERE COALESCE(event_kind,'') = ''",
      "UPDATE core_buybacks SET event_kind = 'BuybackExecuted' WHERE COALESCE(event_kind,'') = ''",
      "UPDATE reward_events SET event_kind = 'RewardClaimed' WHERE COALESCE(event_kind,'') = ''",
      "UPDATE guardian_events SET event_kind = COALESCE(NULLIF(name,''), 'Guardian') WHERE COALESCE(event_kind,'') = ''",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    for (const stmt of [
      "DROP INDEX IF EXISTS idx_claims_log",
      "DROP INDEX IF EXISTS idx_selfburn_log",
      "DROP INDEX IF EXISTS idx_flywheel_log",
      "DROP INDEX IF EXISTS idx_core_buybacks_log",
      "DROP INDEX IF EXISTS idx_reward_events_log",
      "DROP INDEX IF EXISTS idx_guardian_events_log",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    for (const stmt of [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_identity ON claims(chain_id, tx, log_index, event_kind)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_selfburn_identity ON selfburn(chain_id, tx, log_index, event_kind)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_flywheel_identity ON flywheel(chain_id, tx, log_index, event_kind)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_core_buybacks_identity ON core_buybacks(chain_id, tx, log_index, event_kind)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_events_identity ON reward_events(chain_id, tx, log_index, event_kind)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_events_identity ON guardian_events(chain_id, tx, log_index, event_kind)",
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    for (const stmt of [
      `INSERT INTO indexer_event_journal(chain_id,tx,log_index,event_kind,address,block,ts)
       SELECT COALESCE(chain_id,0), tx, COALESCE(log_index,0), COALESCE(NULLIF(event_kind,''),'RewardClaimed'), COALESCE(token,''), block, ts FROM claims
       ON CONFLICT(chain_id, tx, log_index, event_kind) DO NOTHING`,
      `INSERT INTO indexer_event_journal(chain_id,tx,log_index,event_kind,address,block,ts)
       SELECT COALESCE(chain_id,0), tx, COALESCE(log_index,0), COALESCE(NULLIF(event_kind,''),'SelfBurn'), COALESCE(token,''), block, ts FROM selfburn
       ON CONFLICT(chain_id, tx, log_index, event_kind) DO NOTHING`,
      `INSERT INTO indexer_event_journal(chain_id,tx,log_index,event_kind,address,block,ts)
       SELECT COALESCE(chain_id,0), tx, COALESCE(log_index,0), COALESCE(NULLIF(event_kind,''),'Flywheel'), COALESCE(quote,''), block, ts FROM flywheel
       ON CONFLICT(chain_id, tx, log_index, event_kind) DO NOTHING`,
      `INSERT INTO indexer_event_journal(chain_id,tx,log_index,event_kind,address,block,ts)
       SELECT COALESCE(chain_id,0), tx, COALESCE(log_index,0), COALESCE(NULLIF(event_kind,''),'BuybackExecuted'), COALESCE(quote,''), block, ts FROM core_buybacks
       ON CONFLICT(chain_id, tx, log_index, event_kind) DO NOTHING`,
      `INSERT INTO indexer_event_journal(chain_id,tx,log_index,event_kind,address,block,ts)
       SELECT COALESCE(chain_id,0), tx, COALESCE(log_index,0), COALESCE(NULLIF(event_kind,''),'RewardClaimed'), COALESCE(token,''), block, ts FROM reward_events
       ON CONFLICT(chain_id, tx, log_index, event_kind) DO NOTHING`,
      `INSERT INTO indexer_event_journal(chain_id,tx,log_index,event_kind,address,block,ts)
       SELECT COALESCE(chain_id,0), tx, COALESCE(log_index,0), COALESCE(NULLIF(event_kind,''),'Guardian'), '', block, ts FROM guardian_events
       ON CONFLICT(chain_id, tx, log_index, event_kind) DO NOTHING`,
      `INSERT INTO indexer_event_journal(chain_id,tx,log_index,event_kind,address,block,ts)
       SELECT COALESCE(chain_id,0), tx, COALESCE(log_index,0),
         CASE WHEN source = 'v4' THEN 'SwapFeeAccrued' WHEN side = 'buy' THEN 'CurveBuy' WHEN side = 'sell' THEN 'CurveSell' ELSE 'Trade' END,
         COALESCE(token,''), block, ts FROM trades
       ON CONFLICT(chain_id, tx, log_index, event_kind) DO NOTHING`,
    ]) {
      await store.exec(stmt).catch(() => undefined);
    }
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 8, Math.floor(Date.now() / 1000));
    current = 8;
  }
  // v9 = tokens.current_supply (#23). #30 reserves this slot and may jump 8→10.
  await store.exec("ALTER TABLE tokens ADD COLUMN current_supply TEXT").catch(() => undefined);
  await store.exec(
    `UPDATE tokens SET current_supply = supply WHERE current_supply IS NULL OR current_supply = ''`,
  ).catch(() => undefined);
  if (current < 9) {
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 9, Math.floor(Date.now() / 1000));
    current = 9;
  } else {
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 9, Math.floor(Date.now() / 1000)).catch(() => undefined);
  }
  // v10 = external_price_marks.kind (#30).
  if (current < 10) {
    await store.exec("ALTER TABLE external_price_marks ADD COLUMN kind TEXT DEFAULT 'observation'").catch(() => undefined);
    await store.exec(
      "UPDATE external_price_marks SET kind='consensus' WHERE source IN ('consensus','fused','fail','missing') AND (kind IS NULL OR kind='observation')",
    ).catch(() => undefined);
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 10, Math.floor(Date.now() / 1000));
    current = 10;
  }
  if (current < 11) {
    await store.exec(`
      CREATE TABLE IF NOT EXISTS top10_candidate_epochs (
        id TEXT PRIMARY KEY,
        computed_ts INTEGER NOT NULL,
        now_sec INTEGER NOT NULL,
        pause_epoch INTEGER NOT NULL,
        reason TEXT,
        candidates INTEGER,
        source TEXT,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS top10_candidate_rows (
        epoch_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        token TEXT,
        symbol TEXT,
        quote TEXT,
        mark_usdc TEXT,
        weight_bps INTEGER,
        PRIMARY KEY (epoch_id, rank)
      );
      CREATE INDEX IF NOT EXISTS idx_top10_candidate_token ON top10_candidate_rows(token);
    `);
    await store.run("INSERT INTO schema_migrations(id, applied_ts) VALUES(?,?)", 11, Math.floor(Date.now() / 1000));
    current = 11;
  }
  // Executable Arc mark lives on the verified venue row — not a schema_migrations id.
  await ensureRouteVenueMarkColumn(store);
  return current;
}

/** True when `schema_migrations` already has this id. */
export async function migrationApplied(store: Store, id: number): Promise<boolean> {
  const row = await store.get<{ n: number }>("SELECT COUNT(*) as n FROM schema_migrations WHERE id=?", id);
  return Number(row?.n ?? 0) > 0;
}

async function tableHasColumn(store: Store, table: string, column: string): Promise<boolean> {
  if (store.dialect === "postgres") {
    const row = await store.get<{ n: number }>(
      `SELECT COUNT(*) as n FROM information_schema.columns
       WHERE table_schema='public' AND table_name=? AND column_name=?`,
      table,
      column,
    );
    return Number(row?.n ?? 0) > 0;
  }
  const cols = await store.all<{ name: string }>(`PRAGMA table_info(${table})`).catch(() => []);
  return cols.some((c) => c.name === column);
}

/** last_price_quote_x18 on route_venues — not a schema_migrations id. */
export async function ensureRouteVenueMarkColumn(store: Store): Promise<void> {
  const has = await tableHasColumn(store, "route_venues", "last_price_quote_x18").catch(() => false);
  if (has) return;
  await store.exec("ALTER TABLE route_venues ADD COLUMN last_price_quote_x18 TEXT").catch(() => undefined);
}

function postgres(sql: string): string {
  return sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "BIGSERIAL PRIMARY KEY").replace(/AUTOINCREMENT/g, "");
}

/** @deprecated use applyMigrations */
export function sqliteSchema(): string {
  return V1_TABLES;
}

export function postgresSchema(): string {
  return postgres(V1_TABLES);
}
