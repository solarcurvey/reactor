import { createPublicClient, http, parseAbiItem } from "viem";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
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
    sqrtPrice TEXT,
    ts INTEGER
  );
  CREATE TABLE IF NOT EXISTS pools (
    poolId TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    quote TEXT,
    createdBlock INTEGER
  );
`);
for (const col of ["sqrtPrice", "flywheel", "coreAmt"]) {
  try {
    db.exec(`ALTER TABLE swaps ADD COLUMN ${col} TEXT`);
  } catch {
    /* already present */
  }
}
try {
  db.exec(`ALTER TABLE swaps ADD COLUMN ts INTEGER`);
} catch {
  /* already present */
}
for (const col of ["tokensOut TEXT", "source TEXT", "px TEXT"]) {
  try {
    db.exec(`ALTER TABLE swaps ADD COLUMN ${col}`);
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
const instantCurve = (deployment.addresses as { InstantCurve?: string }).InstantCurve as `0x${string}` | undefined;
const selfBurn = (deployment.addresses as { SelfBurnVault?: string }).SelfBurnVault as `0x${string}` | undefined;

const events = [
  parseAbiItem("event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply)"),
  parseAbiItem("event LaunchCreated(address indexed token, uint8 mode, address indexed quote)"),
  parseAbiItem("event InstantMarketOpened(address indexed token, bytes32 indexed poolId, uint256 fdvQuoteRaw, uint256 devBuy)"),
  parseAbiItem("event InstantLaunchCreated(address indexed token, address indexed quote, address indexed creator, bool rewardsMode, uint256 gradTarget)"),
  parseAbiItem("event DevBuyExecuted(address indexed token, address indexed creator, uint256 quoteIn, uint256 tokensOut)"),
  parseAbiItem("event CurveBuy(address indexed token, address indexed buyer, uint256 quoteIn, uint256 tokensOut, uint256 fee)"),
  parseAbiItem("event CurveSell(address indexed token, address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 fee)"),
  parseAbiItem("event BondingProgress(address indexed token, uint256 realQuote, uint256 gradTarget, uint256 inventory)"),
  parseAbiItem("event GraduationTriggered(address indexed token, uint256 realQuote)"),
  parseAbiItem("event GraduationCompleted(address indexed token, bytes32 indexed poolId, uint256 quoteLp, uint256 tokenLp)"),
  parseAbiItem("event SelfBurnAccrued(address indexed token, address indexed quote, uint256 amount)"),
  parseAbiItem("event SelfBurnExecuted(address indexed token, uint256 quoteIn, uint256 burned)"),
  parseAbiItem("event QuoteRouted(address indexed token, address indexed user, address tokenIn, address tokenOut, uint256 amountIn)"),
  parseAbiItem("event RewardsCredited(uint256 amount, uint256 magnifiedDividendPerShare)"),
  parseAbiItem("event RewardClaimed(address indexed account, address indexed to, uint256 amount)"),
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
  parseAbiItem("event EpochSubmitted(uint256 indexed epochId, uint256 n, uint256 pot)"),
  parseAbiItem("event EpochRolled(uint256 indexed epochId)"),
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
const blockTs = new Map<number, number>();

function loadPoolsFromDb() {
  tokenByPool.clear();
  const rows = db.prepare("SELECT poolId, token FROM pools").all() as Array<{ poolId: string; token: string }>;
  for (const r of rows) tokenByPool.set(r.poolId, r.token);
  const fromEvents = db
    .prepare("SELECT payload FROM events WHERE name IN ('OfficialPoolCreated','GraduationCompleted')")
    .all() as Array<{ payload: string }>;
  for (const ev of fromEvents) {
    try {
      const p = JSON.parse(ev.payload) as { poolId?: string; token?: string };
      if (p.poolId && p.token) {
        tokenByPool.set(String(p.poolId), String(p.token));
        db.prepare("INSERT OR IGNORE INTO pools(poolId,token,quote,createdBlock) VALUES(?,?,?,?)").run(
          String(p.poolId),
          String(p.token),
          "",
          0,
        );
      }
    } catch {
      /* skip */
    }
  }
}

function rememberPool(poolId: string, token: string, quote: string, block: number) {
  tokenByPool.set(poolId, token);
  db.prepare("INSERT INTO pools(poolId,token,quote,createdBlock) VALUES(?,?,?,?) ON CONFLICT(poolId) DO UPDATE SET token=excluded.token").run(
    poolId,
    token,
    quote,
    block,
  );
}

loadPoolsFromDb();

async function chainTs(blockNumber: bigint): Promise<number> {
  const n = Number(blockNumber);
  const hit = blockTs.get(n);
  if (hit) return hit;
  const blk = await client.getBlock({ blockNumber });
  const ts = Number(blk.timestamp);
  blockTs.set(n, ts);
  return ts;
}

async function tick() {
  const head = await client.getBlockNumber();
  let from = lastBlock();
  if (from > 0n) from += 1n;
  if (from > head) return;
  const to = head - from > 2000n ? from + 2000n : head;

  const watch = [factory, hook, buyback];
  if (flywheel) watch.push(flywheel);
  if (poolManager) watch.push(poolManager);
  if (instantCurve) watch.push(instantCurve);
  if (selfBurn) watch.push(selfBurn);

  const logs = await client.getLogs({
    address: watch,
    events,
    fromBlock: from,
    toBlock: to,
  });

  const insertEv = db.prepare("INSERT INTO events(block,tx,name,token,payload) VALUES(?,?,?,?,?)");
  const insertSw = db.prepare(
    "INSERT INTO swaps(block,tx,token,quote,holders,buyback,flywheel,coreAmt,notional,sqrtPrice,ts,tokensOut,source,px) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const lastSqrt = new Map<string, string>();

  for (const log of logs) {
    const name = log.eventName ?? "unknown";
    const args = (log.args ?? {}) as Record<string, unknown>;
    const token = String(args.token ?? "");
    if ((name === "OfficialPoolCreated" || name === "GraduationCompleted") && args.poolId) {
      rememberPool(String(args.poolId), token, String(args.quote ?? ""), Number(log.blockNumber));
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
      const ts = await chainTs(log.blockNumber);
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
        ts,
        "",
        "v4",
        "",
      );
    }
    if (name === "CurveBuy" || name === "CurveSell") {
      const ts = await chainTs(log.blockNumber);
      const quoteIn = String(args.quoteIn ?? args.quoteOut ?? "0");
      const tokens = String(args.tokensOut ?? args.tokensIn ?? "0");
      let px = "";
      try {
        const q = BigInt(quoteIn);
        const t = BigInt(tokens);
        if (t > 0n) px = ((q * 10n ** 18n) / t).toString();
      } catch {
        px = "";
      }
      insertSw.run(
        Number(log.blockNumber),
        log.transactionHash,
        token,
        String(args.quote ?? ""),
        "0",
        "0",
        "0",
        "0",
        quoteIn,
        "",
        ts,
        tokens,
        "curve",
        px,
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

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/keeper") {
    const beatPath = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
    if (!existsSync(beatPath)) {
      res.end(JSON.stringify({ ok: false, reason: "no heartbeat" }));
      return;
    }
    res.end(readFileSync(beatPath, "utf8"));
    return;
  }
  if (url.pathname === "/health") {
    const row = db.prepare("SELECT v FROM meta WHERE k='block'").get() as { v: string } | undefined;
    const pools = (db.prepare("SELECT COUNT(*) as n FROM pools").get() as { n: number }).n;
    const head = await client.getBlockNumber().catch(() => 0n);
    const indexed = Number(row?.v ?? 0);
    res.end(
      JSON.stringify({
        ok: true,
        block: indexed,
        head: Number(head),
        lag: Number(head) - indexed,
        pools,
        network: deployment.network,
      }),
    );
    return;
  }
  if (url.pathname === "/events") {
    const rows = db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 200").all();
    res.end(JSON.stringify(rows));
    return;
  }
  if (url.pathname === "/pools") {
    const rows = db.prepare("SELECT * FROM pools").all();
    res.end(JSON.stringify(rows));
    return;
  }
  if (url.pathname === "/reactor") {
    const rows = db
      .prepare("SELECT * FROM events WHERE name IN ('FlywheelAccrued','QuoteSettled','EpochSubmitted','EpochRolled','Top10Buy','COREBurned','BuybackExecuted') ORDER BY id DESC LIMIT 80")
      .all();
    res.end(JSON.stringify({ events: rows }));
    return;
  }
  const swapMatch = url.pathname.match(/^\/swaps\/(0x[a-fA-F0-9]{40})$/);
  if (swapMatch) {
    const rows = db
      .prepare(
        "SELECT block as t, ts, notional, holders, buyback, flywheel, coreAmt, tx, sqrtPrice, tokensOut, source, px FROM swaps WHERE lower(token)=lower(?) ORDER BY id ASC",
      )
      .all(swapMatch[1]);
    res.end(JSON.stringify(rows));
    return;
  }
  const vwapMatch = url.pathname.match(/^\/vwap\/(0x[a-fA-F0-9]{40})$/);
  if (vwapMatch) {
    const windowSec = Number(url.searchParams.get("window") ?? 720);
    const head = await client.getBlock({ blockNumber: await client.getBlockNumber() }).catch(() => null);
    const nowChain = head ? Number(head.timestamp) : 0;
    const since = nowChain - windowSec;
    const rows = db
      .prepare(
        "SELECT ts, notional, sqrtPrice FROM swaps WHERE lower(token)=lower(?) AND COALESCE(ts,0) >= ? ORDER BY id ASC",
      )
      .all(vwapMatch[1], since);
    res.end(JSON.stringify({ windowSec, samples: rows.length, chainTs: nowChain, rows }));
    return;
  }
  const candleMatch = url.pathname.match(/^\/candles\/(0x[a-fA-F0-9]{40})$/);
  if (candleMatch) {
    const interval = url.searchParams.get("interval") ?? "5m";
    const sec =
      interval === "1m" ? 60 : interval === "1h" ? 3600 : interval === "4h" ? 14400 : interval === "1d" ? 86400 : 300;
    const rows = db
      .prepare(
        "SELECT ts, notional, sqrtPrice, px, source FROM swaps WHERE lower(token)=lower(?) AND COALESCE(ts,0) > 0 ORDER BY ts ASC",
      )
      .all(candleMatch[1]) as Array<{ ts: number; notional: string; sqrtPrice: string; px: string; source: string }>;
    type C = { t: number; o: string; h: string; l: string; c: string; v: string; n: number };
    const out: C[] = [];
    for (const r of rows) {
      const bucket = Math.floor(Number(r.ts) / sec) * sec;
      const px = r.sqrtPrice && r.sqrtPrice !== "0" ? r.sqrtPrice : r.px || "0";
      const last = out[out.length - 1];
      if (!last || last.t !== bucket) {
        out.push({ t: bucket, o: px, h: px, l: px, c: px, v: r.notional ?? "0", n: 1 });
      } else {
        last.c = px;
        if (BigInt(px || "0") > BigInt(last.h || "0")) last.h = px;
        if (last.l === "0" || BigInt(px || "0") < BigInt(last.l || "0")) last.l = px;
        last.v = (BigInt(last.v || "0") + BigInt(r.notional || "0")).toString();
        last.n += 1;
      }
    }
    res.end(JSON.stringify({ interval, sec, candles: out, chainTime: true }));
    return;
  }
  if (url.pathname === "/ops") {
    const beatPath = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
    const row = db.prepare("SELECT v FROM meta WHERE k='block'").get() as { v: string } | undefined;
    const pools = (db.prepare("SELECT COUNT(*) as n FROM pools").get() as { n: number }).n;
    const swaps = (db.prepare("SELECT COUNT(*) as n FROM swaps").get() as { n: number }).n;
    const head = await client.getBlockNumber().catch(() => 0n);
    const headBlk = await client.getBlock({ blockNumber: head }).catch(() => null);
    res.end(
      JSON.stringify({
        indexer: {
          block: Number(row?.v ?? 0),
          head: Number(head),
          lag: Number(head) - Number(row?.v ?? 0),
          pools,
          swaps,
          chainTs: headBlk ? Number(headBlk.timestamp) : 0,
        },
        keeper: existsSync(beatPath) ? JSON.parse(readFileSync(beatPath, "utf8")) : null,
        pricing: { usdPegOneOnly: true, stablecoinsAreNotDollar: true },
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`indexer on http://127.0.0.1:${PORT} db=${DB_PATH} pools=${tokenByPool.size}`);
  loop();
});
