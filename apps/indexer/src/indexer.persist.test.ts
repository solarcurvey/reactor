import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "reactor-idx-"));
const dbPath = join(dir, "reactor.sqlite");

function open() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block INTEGER,
      tx TEXT,
      token TEXT,
      quote TEXT,
      holders TEXT,
      buyback TEXT,
      flywheel TEXT,
      coreAmt TEXT,
      notional TEXT,
      sqrtPrice TEXT,
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS pools (
      poolId TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      quote TEXT,
      createdBlock INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      payload TEXT
    );
  `);
  return db;
}

{
  let db = open();
  const poolId = "0xabc";
  const token = "0x1111111111111111111111111111111111111111";
  db.prepare("INSERT INTO pools(poolId,token,quote,createdBlock) VALUES(?,?,?,?)").run(poolId, token, "0xusd", 10);
  const chainTs = 1_700_000_000; // historical
  const nowWall = Math.floor(Date.now() / 1000);
  assert(nowWall - chainTs > 3600, "fixture is >1h old vs wall clock");
  db.prepare(
    "INSERT INTO swaps(block,tx,token,quote,holders,buyback,flywheel,coreAmt,notional,sqrtPrice,ts) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(10, "0xtx", token, "0xusd", "0", "0", "0", "0", "1000", "123", chainTs);
  db.close();

  db = open();
  const tokenByPool = new Map<string, string>();
  for (const r of db.prepare("SELECT poolId, token FROM pools").all() as Array<{ poolId: string; token: string }>) {
    tokenByPool.set(r.poolId, r.token);
  }
  assert(tokenByPool.get(poolId) === token, "restart must reconstruct poolId→token from SQLite");

  const windowSec = 12 * 60;
  const nowChain = chainTs + 60; // catch-up: chain head only 60s after the swap
  const inWin = db
    .prepare("SELECT ts FROM swaps WHERE COALESCE(ts,0) >= ?")
    .all(nowChain - windowSec) as Array<{ ts: number }>;
  assert(inWin.length === 1, "chain-time window still includes the swap");

  const laterChain = chainTs + 3600 + 60; // indexer offline 1h then catch up
  const after = db
    .prepare("SELECT ts FROM swaps WHERE COALESCE(ts,0) >= ?")
    .all(laterChain - windowSec) as Array<{ ts: number }>;
  assert(after.length === 0, "old swap must NOT sit in the current ~12m ranking window after 1h catch-up");

  const wallNow = Math.floor(Date.now() / 1000);
  if (wallNow - chainTs < windowSec) {
    throw new Error("Date.now() would have incorrectly placed a historical swap in-window — test clock assumption");
  }
  db.close();
}

rmSync(dir, { recursive: true, force: true });
console.log("indexer persist + historical ts tests ok");
