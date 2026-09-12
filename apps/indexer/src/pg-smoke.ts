/**
 * Idempotent Postgres smoke: schema + one index cycle.
 * Requires DATABASE_URL=postgres://…
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke
 */
import { openStore, type Store } from "./db.ts";
import { getState, recordTrade, upsertMarket, upsertToken } from "./ingest.ts";
import { persistVenue, planFeeExemptRoute } from "./route-graph.ts";
import { saveJob } from "./keeper-jobs.ts";
import { persistTickBatch } from "./tick-persist.ts";
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
{
  const token = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const quote = "0xcccccccccccccccccccccccccccccccccccccccc";
  const logs = [
    {
      eventName: "TokenCreated",
      args: { token, creator: quote, name: "PG", symbol: "PG", supply: "1" },
      blockNumber: 9n,
      transactionHash: "0xpgatomic1",
      logIndex: 0,
    },
    {
      eventName: "InstantLaunchCreated",
      args: { token, quote, creator: quote, rewardsMode: true, gradTarget: "1" },
      blockNumber: 9n,
      transactionHash: "0xpgatomic1",
      logIndex: 1,
    },
  ];
  const timestamps = new Map<number, number>([[9, 1_700_000_010]]);
  const ctx = {
    chainId: 5042002,
    factory: proto,
    hook: proto,
    tokenByPool: new Map<string, { token: string; quote: string }>(),
    quoteDec: new Map<string, number>(),
  };
  function crashOnCursor(inner: Store): Store {
    const wrap = (s: Store): Store => ({
      dialect: s.dialect,
      exec: (sql) => s.exec(sql),
      run: async (sql, ...params) => {
        if (/indexer_state/i.test(sql)) throw new Error("injected crash");
        return s.run(sql, ...params);
      },
      runChanges: (sql, ...params) => s.runChanges(sql, ...params),
      get: (sql, ...p) => s.get(sql, ...p),
      all: (sql, ...p) => s.all(sql, ...p),
      transaction: (fn) => s.transaction((tx) => fn(wrap(tx))),
      close: () => s.close(),
      tryAdvisoryLock: (n, o, t) => s.tryAdvisoryLock(n, o, t),
      acquireLease: (n, o, t) => s.acquireLease(n, o, t),
      renewLease: (n, o, f, t) => s.renewLease(n, o, f, t),
      hasLease: (n, o, f) => s.hasLease(n, o, f),
      releaseLock: (n, o) => s.releaseLock(n, o),
      releaseLease: (n, o, f) => s.releaseLease(n, o, f),
    });
    return wrap(inner);
  }
  const beforeBlock = await getState(store, "block");
  const beforeHash = await getState(store, "block_hash");
  const beforeTokens = Number((await store.get<{ n: string }>("SELECT COUNT(*)::text AS n FROM tokens WHERE address=?", token))?.n ?? 0);
  let crashed = false;
  try {
    await persistTickBatch(crashOnCursor(store), {
      logs,
      timestamps,
      cursorBlock: "9000009",
      cursorHash: "0xpghash-crash",
      ctx,
    });
  } catch (e) {
    crashed = String(e).includes("injected crash");
  }
  assert(crashed, "pg atomic crash injected");
  const n = await store.get<{ n: string }>("SELECT COUNT(*)::text AS n FROM tokens WHERE address=?", token);
  assert(Number(n?.n ?? 0) === beforeTokens, "pg crash rolled back token with cursor");
  assert((await getState(store, "block")) === beforeBlock, "pg crash did not advance cursor");
  assert((await getState(store, "block_hash")) === beforeHash, "pg crash did not change hash");
  await persistTickBatch(store, { logs, timestamps, cursorBlock: "9", cursorHash: "0xpghash", ctx });
  assert((await getState(store, "block")) === "9", "pg commit cursor");

  const claimTok = "0xdddddddddddddddddddddddddddddddddddddddd";
  const claimTx = "0xpgidentityclaimtx000000000000000000000000000000000000000000000001";
  const claimLogs = [3, 4].map((logIndex) => ({
    eventName: "RewardClaimed",
    args: { token: claimTok, account: quote, amount: "20" },
    blockNumber: 9n,
    transactionHash: claimTx,
    logIndex,
  }));
  await persistTickBatch(store, {
    logs: claimLogs,
    timestamps,
    cursorBlock: "9",
    cursorHash: "0xpghash",
    ctx,
  });
  await persistTickBatch(store, {
    logs: claimLogs,
    timestamps,
    cursorBlock: "9",
    cursorHash: "0xpghash",
    ctx,
  });
  const claimN = await store.get<{ n: string }>("SELECT COUNT(*)::text AS n FROM claims WHERE tx=?", claimTx);
  assert(Number(claimN?.n ?? 0) === 2, "pg two same-kind claims at different log indexes; replay idempotent");
  const rewardN = await store.get<{ n: string }>("SELECT COUNT(*)::text AS n FROM reward_events WHERE tx=?", claimTx);
  assert(Number(rewardN?.n ?? 0) === 2, "pg reward_events share claim identity");
  const journalN = await store.get<{ n: string }>("SELECT COUNT(*)::text AS n FROM indexer_event_journal WHERE tx=?", claimTx);
  assert(Number(journalN?.n ?? 0) === 2, "pg journal two RewardClaimed identities");

  const burnTok = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const burnTx = "0xpgburncursortx00000000000000000000000000000000000000000000000001";
  const burnSupply = "1000000000000000000000000000";
  const holderBurn = "40000000000000000000000000";
  await persistTickBatch(store, {
    logs: [
      {
        eventName: "TokenCreated",
        args: { token: burnTok, creator: quote, name: "BRN", symbol: "BRN", supply: burnSupply },
        address: proto,
        blockNumber: 9n,
        transactionHash: "0xpgburnseed0000000000000000000000000000000000000000000000000001",
        logIndex: 0,
      },
    ],
    timestamps,
    cursorBlock: "9",
    cursorHash: "0xpghash",
    ctx,
  });
  const burnLogs = [
    {
      eventName: "Transfer",
      args: { from: quote, to: "0x0000000000000000000000000000000000000000", amount: holderBurn },
      address: burnTok,
      blockNumber: 9n,
      transactionHash: burnTx,
      logIndex: 20,
    },
    {
      eventName: "Burned",
      args: { account: quote, amount: holderBurn },
      address: burnTok,
      blockNumber: 9n,
      transactionHash: burnTx,
      logIndex: 21,
    },
  ];
  let burnCrashed = false;
  try {
    await persistTickBatch(crashOnCursor(store), {
      logs: [],
      burnLogs,
      timestamps,
      cursorBlock: "9000010",
      cursorHash: "0xpghash-burn-crash",
      ctx,
    });
  } catch (e) {
    burnCrashed = String(e).includes("injected crash");
  }
  assert(burnCrashed, "pg burn+cursor crash injected");
  assert((await getState(store, "block")) === "9", "pg burn crash did not advance cursor");
  const burnJournalCrash = await store.get<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM indexer_event_journal WHERE tx=? AND event_kind IN ('Transfer','Burned')",
    burnTx,
  );
  assert(Number(burnJournalCrash?.n ?? 0) === 0, "pg burn crash dropped journal with cursor");
  await persistTickBatch(store, {
    logs: [],
    burnLogs,
    timestamps,
    cursorBlock: "10",
    cursorHash: "0xpghash-burn",
    ctx,
  });
  assert((await getState(store, "block")) === "10", "pg burn retry commits cursor");
  const burnJournalOk = await store.get<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM indexer_event_journal WHERE tx=? AND event_kind IN ('Transfer','Burned')",
    burnTx,
  );
  assert(Number(burnJournalOk?.n ?? 0) === 2, "pg burn journal committed with cursor");
  await persistTickBatch(store, {
    logs: [],
    burnLogs: [],
    timestamps,
    cursorBlock: "11",
    cursorHash: "0xpghash-burn-next",
    ctx,
  });
  const burnJournalRestart = await store.get<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM indexer_event_journal WHERE tx=? AND event_kind IN ('Transfer','Burned')",
    burnTx,
  );
  assert(Number(burnJournalRestart?.n ?? 0) === 2, "pg restart from cursor+1 cannot drop burn journal");
}
await store.close();
console.log("postgres smoke ok");
