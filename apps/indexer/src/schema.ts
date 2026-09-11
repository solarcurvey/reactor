/** Production schema. Postgres is the target; SQLite is local-only (translated). */

export const TABLES = [
  "indexer_state",
  "tokens",
  "markets",
  "quote_assets",
  "pool_relationships",
  "trades",
  "candles",
  "bonding_states",
  "graduations",
  "reward_events",
  "claims",
  "selfburn",
  "flywheel",
  "core_buybacks",
  "top10_epochs",
  "targets",
  "keeper_operations",
  "guardian_events",
  "route_venues",
  "external_price_marks",
  "metadata",
  "leader_locks",
  "alerts",
] as const;

export function sqliteSchema(): string {
  return `
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
  UNIQUE(tx, log_index)
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
  token TEXT,
  amount TEXT,
  block INTEGER,
  tx TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT,
  account TEXT,
  amount TEXT,
  block INTEGER,
  tx TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS selfburn (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT,
  quote TEXT,
  amount TEXT,
  burned TEXT,
  kind TEXT,
  block INTEGER,
  tx TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS flywheel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote TEXT,
  amount TEXT,
  usdc_in TEXT,
  kind TEXT,
  block INTEGER,
  tx TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS core_buybacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote TEXT,
  quote_in TEXT,
  core_out TEXT,
  block INTEGER,
  tx TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS top10_epochs (
  epoch_id TEXT PRIMARY KEY,
  pot TEXT,
  n INTEGER,
  finalized INTEGER,
  paused INTEGER,
  reason TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS targets (
  epoch_id TEXT,
  rank INTEGER,
  token TEXT,
  weight_bps INTEGER,
  mark_usdc TEXT,
  PRIMARY KEY (epoch_id, rank)
);
CREATE TABLE IF NOT EXISTS keeper_operations (
  id TEXT PRIMARY KEY,
  kind TEXT,
  status TEXT,
  hash TEXT,
  nonce TEXT,
  receipt TEXT,
  note TEXT,
  request_id TEXT,
  op_id TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS guardian_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  payload TEXT,
  block INTEGER,
  tx TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS route_venues (
  id TEXT PRIMARY KEY,
  token_in TEXT,
  token_out TEXT,
  adapter TEXT,
  kind TEXT,
  data TEXT,
  pool_id TEXT,
  exists_onchain INTEGER,
  approved INTEGER,
  reliability_bps INTEGER
);
CREATE TABLE IF NOT EXISTS external_price_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT,
  symbol TEXT,
  source TEXT,
  usd6 TEXT,
  ts INTEGER,
  ok INTEGER,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS metadata (
  token TEXT PRIMARY KEY,
  image TEXT,
  description TEXT,
  website TEXT,
  twitter TEXT,
  telegram TEXT,
  media_id TEXT
);
CREATE TABLE IF NOT EXISTS leader_locks (
  name TEXT PRIMARY KEY,
  owner TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT,
  code TEXT,
  detail TEXT,
  ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trades_token_ts ON trades(token, ts);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);
CREATE INDEX IF NOT EXISTS idx_candles_token ON candles(token, interval_sec, t);
CREATE INDEX IF NOT EXISTS idx_markets_stage ON markets(stage);
CREATE INDEX IF NOT EXISTS idx_markets_quote ON markets(quote);
CREATE INDEX IF NOT EXISTS idx_keeper_status ON keeper_operations(status, ts);
CREATE INDEX IF NOT EXISTS idx_venues_pair ON route_venues(token_in, token_out);
CREATE INDEX IF NOT EXISTS idx_marks_token_ts ON external_price_marks(token, ts);
CREATE INDEX IF NOT EXISTS idx_events_token ON reward_events(token);
`;
}

export function postgresSchema(): string {
  return sqliteSchema()
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "BIGSERIAL PRIMARY KEY")
    .replace(/INSERT OR IGNORE/g, "INSERT")
    .replace(/AUTOINCREMENT/g, "");
}
