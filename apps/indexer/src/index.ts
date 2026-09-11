import { createPublicClient, http, parseAbiItem } from "viem";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import deployment from "./deployment.json" with { type: "json" };

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const PORT = Number(process.env.INDEXER_PORT ?? 43148);
const DB_PATH = process.env.INDEXER_DB ?? new URL("../data/reactor.sqlite", import.meta.url).pathname;

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block INTEGER,
    tx TEXT,
    name TEXT,
    token TEXT,
    payload TEXT
  );
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
    sqrtPrice TEXT
  );
`);
for (const col of ["sqrtPrice", "flywheel", "coreAmt"]) {
  try {
    db.exec(`ALTER TABLE swaps ADD COLUMN ${col} TEXT`);
  } catch {
    /* already present */
  }
}

const client = createPublicClient({
  transport: http(RPC),
});

const factory = deployment.addresses.ReactorFactory as `0x${string}`;
const hook = deployment.addresses.ReactorHook as `0x${string}`;
const buyback = deployment.addresses.BuybackVault as `0x${string}`;
const flywheel = (deployment.addresses as { FlywheelVault?: string }).FlywheelVault as `0x${string}` | undefined;
const poolManager = (deployment.addresses as { PoolManager?: string }).PoolManager as `0x${string}` | undefined;

const events = [
  parseAbiItem("event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply)"),
  parseAbiItem("event LaunchCreated(address indexed token, uint8 mode, address indexed quote)"),
  parseAbiItem("event InstantMarketOpened(address indexed token, bytes32 indexed poolId, uint256 fdvQuoteRaw, uint256 devBuy)"),
  parseAbiItem("event BatchFairLaunchCreated(uint256 indexed fairId, address indexed token, uint64 startTime, uint64 endTime)"),
  parseAbiItem("event BatchFairLaunchFinalized(uint256 indexed fairId, uint256 totalBids, uint256 auctionTokens)"),
  parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"),
  parseAbiItem("event OfficialPoolCreated(address indexed token, bytes32 indexed poolId, uint8 mode)"),
  parseAbiItem("event SwapFeeAccrued(bytes32 indexed poolId, address indexed quote, uint256 holders, uint256 flywheel, uint256 coreAmt, uint256 notional)"),
  parseAbiItem("event RewardClaimed(address indexed account, address indexed to, uint256 amount)"),
  parseAbiItem("event BuybackAccrued(address indexed quote, uint256 amount)"),
  parseAbiItem("event BuybackExecuted(address indexed quote, uint256 quoteIn, uint256 coreOut, address indexed caller)"),
  parseAbiItem("event COREBurned(uint256 amount)"),
  parseAbiItem("event FlywheelAccrued(address indexed quote, uint256 amount)"),
  parseAbiItem("event QuoteSettled(address indexed quote, uint256 usdcIn)"),
  parseAbiItem("event EpochFinalized(uint256 indexed epoch, uint256 n, uint256 pot)"),
  parseAbiItem("event Top10Buy(uint256 indexed epoch, address indexed token, uint256 usdcIn, uint256 burned)"),
  parseAbiItem("event Skipped(address indexed target, string reason)"),
];

function lastBlock(): bigint {
  const row = db.prepare("SELECT v FROM meta WHERE k='block'").get() as { v: string } | undefined;
  return row ? BigInt(row.v) : 0n;
}

function setBlock(b: bigint) {
  db.prepare("INSERT INTO meta(k,v) VALUES('block',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(b.toString());
}

const tokenByPool = new Map<string, string>();

async function tick() {
  const head = await client.getBlockNumber();
  let from = lastBlock();
  if (from > 0n) from += 1n;
  if (from > head) return;
  const to = head - from > 2000n ? from + 2000n : head;

  const watch = [factory, hook, buyback];
  if (flywheel) watch.push(flywheel);
  if (poolManager) watch.push(poolManager);

  const logs = await client.getLogs({
    address: watch,
    events,
    fromBlock: from,
    toBlock: to,
  });

  const insertEv = db.prepare("INSERT INTO events(block,tx,name,token,payload) VALUES(?,?,?,?,?)");
  const insertSw = db.prepare(
    "INSERT INTO swaps(block,tx,token,quote,holders,buyback,flywheel,coreAmt,notional,sqrtPrice) VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  const lastSqrt = new Map<string, string>();

  for (const log of logs) {
    const name = log.eventName ?? "unknown";
    const args = (log.args ?? {}) as Record<string, unknown>;
    const token = String(args.token ?? "");
    if (name === "OfficialPoolCreated" && args.poolId) {
      tokenByPool.set(String(args.poolId), token);
    }
    if (name === "Swap" && args.id && args.sqrtPriceX96) {
      lastSqrt.set(String(args.id), String(args.sqrtPriceX96));
    }
    insertEv.run(
      Number(log.blockNumber),
      log.transactionHash,
      name,
      token,
      JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    if (name === "SwapFeeAccrued") {
      const poolId = String(args.poolId ?? "");
      const fly = String(args.flywheel ?? "0");
      const coreAmt = String(args.coreAmt ?? "0");
      insertSw.run(
        Number(log.blockNumber),
        log.transactionHash,
        tokenByPool.get(poolId) ?? "",
        String(args.quote ?? ""),
        String(args.holders ?? "0"),
        String(args.buyback ?? fly),
        fly,
        coreAmt,
        String(args.notional ?? "0"),
        lastSqrt.get(poolId) ?? "",
      );
    }
  }
  setBlock(to);
}

async function loop() {
  try {
    await tick();
  } catch (e) {
    console.error("index tick", e);
  }
  setTimeout(loop, 2500);
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") {
    const row = db.prepare("SELECT v FROM meta WHERE k='block'").get() as { v: string } | undefined;
    res.end(JSON.stringify({ ok: true, block: Number(row?.v ?? 0), network: deployment.network }));
    return;
  }
  if (url.pathname === "/events") {
    const rows = db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 200").all();
    res.end(JSON.stringify(rows));
    return;
  }
  if (url.pathname === "/reactor") {
    const rows = db
      .prepare("SELECT * FROM events WHERE name IN ('FlywheelAccrued','QuoteSettled','EpochFinalized','Top10Buy','Skipped','COREBurned','BuybackExecuted') ORDER BY id DESC LIMIT 80")
      .all();
    res.end(JSON.stringify({ events: rows }));
    return;
  }
  const swapMatch = url.pathname.match(/^\/swaps\/(0x[a-fA-F0-9]{40})$/);
  if (swapMatch) {
    const rows = db
      .prepare(
        "SELECT block as t, notional, holders, buyback, flywheel, coreAmt, tx, sqrtPrice FROM swaps WHERE lower(token)=lower(?) ORDER BY id ASC",
      )
      .all(swapMatch[1]);
    res.end(JSON.stringify(rows));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`indexer on http://127.0.0.1:${PORT} db=${DB_PATH}`);
  loop();
});
