/**
 * Regression: event writes + indexer cursor advance are one transaction.
 * Runs SQLite always. Runs Postgres when DATABASE_URL (or the compose default) is reachable.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { openStore, type Store } from "./db.ts";
import { getState } from "./ingest.ts";
import { persistTickBatch, rewindIndexerCursor, type TickLog, type TickPersistCtx } from "./tick-persist.ts";

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
    blockNumber: extra?.blockNumber ?? 10n,
    transactionHash: extra?.transactionHash ?? `0x${"ab".repeat(32)}`,
    logIndex: extra?.logIndex ?? 0,
  };
}

function crashStore(inner: Store, shouldCrash: (sql: string, writeIndex: number) => boolean): Store {
  let writes = 0;
  const wrap = (s: Store): Store => ({
    dialect: s.dialect,
    exec: (sql) => s.exec(sql),
    run: async (sql, ...params) => {
      writes += 1;
      if (shouldCrash(sql, writes)) throw new Error("injected crash");
      return s.run(sql, ...params);
    },
    runChanges: async (sql, ...params) => {
      writes += 1;
      if (shouldCrash(sql, writes)) throw new Error("injected crash");
      return s.runChanges(sql, ...params);
    },
    get: (sql, ...p) => s.get(sql, ...p),
    all: (sql, ...p) => s.all(sql, ...p),
    transaction: (fn) => s.transaction((tx) => fn(wrap(tx))),
    close: () => s.close(),
    tryAdvisoryLock: (n, o, t) => s.tryAdvisoryLock(n, o, t),
    releaseLock: (n, o) => s.releaseLock(n, o),
  });
  return wrap(inner);
}

function ctx(): TickPersistCtx {
  return {
    chainId: 5042002,
    factory: addr("f1"),
    hook: addr("h1"),
    tokenByPool: new Map(),
    quoteDec: new Map([[addr("q1"), 6]]),
  };
}

function txh(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

function launchLogs(token: string, quote: string, tx = txh()): TickLog[] {
  return [
    log("TokenCreated", { token, creator: addr("c1"), name: "Cat", symbol: "CAT", supply: "1000000000000000000000000000" }, { transactionHash: tx, logIndex: 0 }),
    log("InstantLaunchCreated", { token, quote, creator: addr("c1"), rewardsMode: true, gradTarget: "1000" }, { transactionHash: tx, logIndex: 1 }),
    log("CurveBuy", { token, buyer: addr("b1"), quoteIn: "1000", tokensOut: "5000", fee: "35" }, { transactionHash: tx, logIndex: 2 }),
    log("RewardClaimed", { token, account: addr("b1"), amount: "20" }, { transactionHash: tx, logIndex: 3 }),
  ];
}

const timestamps = new Map<number, number>([[10, 1_700_000_000], [20, 1_700_000_100]]);

async function countTrades(store: Store, token: string): Promise<number> {
  const row = await store.get<{ n: number | string }>("SELECT COUNT(*) as n FROM trades WHERE token=?", token);
  return Number(row?.n ?? 0);
}

async function countTokens(store: Store, token: string): Promise<number> {
  const row = await store.get<{ n: number | string }>("SELECT COUNT(*) as n FROM tokens WHERE address=?", token);
  return Number(row?.n ?? 0);
}

async function runSuite(store: Store, label: string) {
  const token = addr(randomBytes(8).toString("hex"));
  const quote = addr("q1");
  const logs = launchLogs(token, quote);
  const persistCtx = ctx();
  const cursor1 = String(10_000_000 + (Date.now() % 1_000_000));
  const hash1 = `0x${randomBytes(8).toString("hex")}`;

  const committed = await persistTickBatch(store, {
    logs,
    timestamps,
    cursorBlock: cursor1,
    cursorHash: hash1,
    ctx: persistCtx,
  });
  assert(committed.some((e) => e.type === "launch"), `${label}: SSE collected only after commit path`);
  assert((await getState(store, "block")) === cursor1, `${label}: cursor block`);
  assert((await getState(store, "block_hash")) === hash1, `${label}: cursor hash`);
  assert((await countTokens(store, token)) === 1, `${label}: token persisted`);
  assert((await countTrades(store, token)) === 1, `${label}: trade persisted`);
  const candle = await store.get<{ n: number }>("SELECT n FROM candles WHERE token=? AND interval_sec=60", token);
  assert(candle && Number(candle.n) >= 1, `${label}: candle with trade`);
  const claim = await store.get<{ n: number | string }>("SELECT COUNT(*) as n FROM claims WHERE token=?", token);
  assert(Number(claim?.n ?? 0) === 1, `${label}: claim persisted`);

  const replay = await persistTickBatch(store, {
    logs,
    timestamps,
    cursorBlock: cursor1,
    cursorHash: hash1,
    ctx: persistCtx,
  });
  assert((await countTrades(store, token)) === 1, `${label}: replay does not duplicate trades`);
  assert((await countTokens(store, token)) === 1, `${label}: replay upsert token`);
  assert(Number((await store.get<{ n: number | string }>("SELECT COUNT(*) as n FROM claims WHERE token=?", token))?.n ?? 0) === 1, `${label}: replay unique claim`);
  void replay;

  const token2 = addr(randomBytes(8).toString("hex"));
  const logs2 = launchLogs(token2, quote);
  const cursor2 = String(Number(cursor1) + 10);
  const hash2 = `0x${randomBytes(8).toString("hex")}`;
  let crashed = false;
  try {
    await persistTickBatch(
      crashStore(store, (sql) => /indexer_state/i.test(sql)),
      { logs: logs2, timestamps, cursorBlock: cursor2, cursorHash: hash2, ctx: ctx() },
    );
  } catch (e) {
    crashed = String(e).includes("injected crash");
  }
  assert(crashed, `${label}: cursor-write crash injected`);
  assert((await getState(store, "block")) === cursor1, `${label}: cursor not advanced after crash`);
  assert((await getState(store, "block_hash")) === hash1, `${label}: hash not advanced after crash`);
  assert((await countTokens(store, token2)) === 0, `${label}: token rolled back with cursor`);
  assert((await countTrades(store, token2)) === 0, `${label}: trade rolled back with cursor`);

  const token3 = addr(randomBytes(8).toString("hex"));
  const logs3 = launchLogs(token3, quote);
  crashed = false;
  try {
    await persistTickBatch(
      crashStore(store, (_sql, n) => n >= 3),
      { logs: logs3, timestamps, cursorBlock: cursor2, cursorHash: hash2, ctx: ctx() },
    );
  } catch (e) {
    crashed = String(e).includes("injected crash");
  }
  assert(crashed, `${label}: mid-batch crash injected`);
  assert((await getState(store, "block")) === cursor1, `${label}: cursor unchanged after mid-batch crash`);
  assert((await countTokens(store, token3)) === 0, `${label}: partial token writes rolled back`);
  assert((await countTrades(store, token3)) === 0, `${label}: partial trade writes rolled back`);

  const recovered = await persistTickBatch(store, {
    logs: logs3,
    timestamps,
    cursorBlock: cursor2,
    cursorHash: hash2,
    ctx: ctx(),
  });
  assert((await getState(store, "block")) === cursor2, `${label}: retry after rollback commits cursor`);
  assert((await countTrades(store, token3)) === 1, `${label}: retry after rollback commits trade`);
  assert(recovered.some((e) => e.type === "launch"), `${label}: retry SSE after rollback`);

  crashed = false;
  try {
    let hashWrites = 0;
    await rewindIndexerCursor(
      crashStore(store, (sql) => {
        if (!/indexer_state/i.test(sql)) return false;
        hashWrites += 1;
        return hashWrites >= 2;
      }),
      "5",
    );
  } catch (e) {
    crashed = String(e).includes("injected crash");
  }
  assert(crashed, `${label}: rewind crash injected`);
  assert((await getState(store, "block")) === cursor2, `${label}: rewind is atomic — block not left without hash clear`);
  assert((await getState(store, "block_hash")) === hash2, `${label}: rewind hash unchanged on crash`);

  const rewindTo = String(Math.max(1, Number(cursor2) - 15));
  await rewindIndexerCursor(store, rewindTo);
  assert((await getState(store, "block")) === rewindTo, `${label}: rewind block`);
  assert((await getState(store, "block_hash")) === "", `${label}: rewind clears hash`);

  console.log(`tick atomic ok (${label})`);
}

async function countWhere(store: Store, sql: string, ...params: unknown[]): Promise<number> {
  const row = await store.get<{ n: number | string }>(sql, ...params);
  return Number(row?.n ?? 0);
}

async function runIdentitySuite(store: Store, label: string) {
  const token = addr(randomBytes(8).toString("hex"));
  const quote = addr("q1");
  const account = addr("b1");
  const tx = txh();
  const logs: TickLog[] = [
    log("RewardClaimed", { token, account, amount: "20" }, { transactionHash: tx, logIndex: 3 }),
    log("RewardClaimed", { token, account, amount: "20" }, { transactionHash: tx, logIndex: 4 }),
    log("SelfBurnAccrued", { token, quote, amount: "7" }, { transactionHash: tx, logIndex: 5 }),
    log("SelfBurnAccrued", { token, quote, amount: "7" }, { transactionHash: tx, logIndex: 6 }),
    log("FlywheelAccrued", { quote, amount: "3" }, { transactionHash: tx, logIndex: 7 }),
    log("FlywheelAccrued", { quote, amount: "3" }, { transactionHash: tx, logIndex: 8 }),
    log("BuybackExecuted", { quote, quoteIn: "9", coreOut: "1" }, { transactionHash: tx, logIndex: 9 }),
    log("BuybackExecuted", { quote, quoteIn: "9", coreOut: "1" }, { transactionHash: tx, logIndex: 10 }),
    log("CurveBuy", { token, buyer: account, quoteIn: "1000", tokensOut: "5000", fee: "35" }, { transactionHash: tx, logIndex: 11 }),
    log("CurveBuy", { token, buyer: account, quoteIn: "1000", tokensOut: "5000", fee: "35" }, { transactionHash: tx, logIndex: 12 }),
  ];
  const persistCtx = ctx();
  persistCtx.chainId = 5042002;
  await persistTickBatch(store, {
    logs,
    timestamps,
    cursorBlock: String(30_000_000 + (Date.now() % 1_000_000)),
    cursorHash: `0x${randomBytes(8).toString("hex")}`,
    ctx: persistCtx,
  });
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM claims WHERE token=? AND tx=?", token, tx)) === 2, `${label}: two identical claims at different log indexes`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM selfburn WHERE token=? AND tx=?", token, tx)) === 2, `${label}: two identical selfburn at different log indexes`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM flywheel WHERE quote=? AND tx=?", quote, tx)) === 2, `${label}: two identical flywheel at different log indexes`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM core_buybacks WHERE quote=? AND tx=?", quote, tx)) === 2, `${label}: two identical buybacks at different log indexes`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM trades WHERE token=? AND tx=?", token, tx)) === 2, `${label}: two identical trades at different log indexes`);

  await persistTickBatch(store, {
    logs,
    timestamps,
    cursorBlock: String(30_000_000 + (Date.now() % 1_000_000)),
    cursorHash: `0x${randomBytes(8).toString("hex")}`,
    ctx: persistCtx,
  });
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM claims WHERE token=? AND tx=?", token, tx)) === 2, `${label}: replay does not duplicate claims`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM selfburn WHERE token=? AND tx=?", token, tx)) === 2, `${label}: replay does not duplicate selfburn`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM flywheel WHERE quote=? AND tx=?", quote, tx)) === 2, `${label}: replay does not duplicate flywheel`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM core_buybacks WHERE quote=? AND tx=?", quote, tx)) === 2, `${label}: replay does not duplicate buybacks`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM trades WHERE token=? AND tx=?", token, tx)) === 2, `${label}: replay does not duplicate trades`);

  const otherChain = { ...persistCtx, chainId: 1, tokenByPool: new Map() };
  await persistTickBatch(store, {
    logs,
    timestamps,
    cursorBlock: String(40_000_000 + (Date.now() % 1_000_000)),
    cursorHash: `0x${randomBytes(8).toString("hex")}`,
    ctx: otherChain,
  });
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM claims WHERE tx=?", tx)) === 4, `${label}: same tx+log on another chain does not collide`);
  assert((await countWhere(store, "SELECT COUNT(*) as n FROM trades WHERE tx=?", tx)) === 4, `${label}: trades are chain-scoped`);
  const kinds = await store.all<{ chain_id: number | string; log_index: number | string }>(
    "SELECT chain_id, log_index FROM claims WHERE tx=? ORDER BY chain_id, log_index",
    tx,
  );
  assert(kinds.length === 4, `${label}: four claim identities`);
  const keys = new Set(kinds.map((r) => `${r.chain_id}:${r.log_index}`));
  assert(keys.size === 4, `${label}: claim identities are (chain_id, log_index)`);

  console.log(`tick log identity ok (${label})`);
}

const dir = mkdtempSync(join(tmpdir(), "reactor-tick-"));
const sqlite = await openStore({ sqlitePath: join(dir, "t.sqlite") });
await runSuite(sqlite, "sqlite");
await runIdentitySuite(sqlite, "sqlite");
await sqlite.close();
rmSync(dir, { recursive: true, force: true });

const pgUrl = process.env.DATABASE_URL?.startsWith("postgres")
  ? process.env.DATABASE_URL
  : process.env.PG_TEST_URL?.startsWith("postgres")
    ? process.env.PG_TEST_URL
    : "postgres://reactor:reactor@127.0.0.1:54329/reactor";

let postgresRan = false;
try {
  const pg = await openStore({ databaseUrl: pgUrl });
  assert(pg.dialect === "postgres", "postgres dialect");
  await runSuite(pg, "postgres");
  await runIdentitySuite(pg, "postgres");
  await pg.close();
  postgresRan = true;
} catch (e) {
  if (process.env.REQUIRE_PG === "1" || process.env.DATABASE_URL?.startsWith("postgres")) {
    throw e;
  }
  console.log(`tick atomic postgres skipped: ${e instanceof Error ? e.message : e}`);
}

if (!postgresRan && (process.env.REQUIRE_PG === "1" || process.env.DATABASE_URL?.startsWith("postgres"))) {
  throw new Error("postgres suite required but did not run");
}

console.log("tick atomic tests ok");
