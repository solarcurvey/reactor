import { parseAbiItem } from "viem";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import deployment from "./deployment.json" with { type: "json" };
import { openStore, type Store } from "./db.ts";
import { rpcFromEnv } from "./rpc.ts";
import { SseHub } from "./sse.ts";
import { ObjectStore, publicMediaUrl } from "./media.ts";
import { RateLimit, SECURITY_HEADERS, logLine, requestId } from "./obs.ts";
import { curvePriceX18, getState, recordTrade, setState, upsertMarket, upsertToken } from "./ingest.ts";
import { isUniqueViolation } from "./unique.ts";
import { loadValuationService } from "./valuation-store.ts";
import { populateExternalPriceMarks } from "./price-marks.ts";
import { buildQuote } from "./quote-service.ts";
import { persistVenue } from "./route-graph.ts";
import { fillContinuous, CANDLE_INTERVALS } from "../../../packages/reactor/src/prices.ts";
import { raiseAlert, recentAlerts } from "./alerts.ts";
import type { ValuationService } from "../../../packages/reactor/src/valuation.ts";
import { consensusUsd6, StaticProvider } from "../../../packages/reactor/src/pricing.ts";
import { priceQuoteX18FromSqrt } from "../../../packages/reactor/src/prices.ts";
import { admit, tryNormalizeTicker } from "./admission.ts";
import { authorizeLaunch } from "./authorize.ts";
import { isReservedTicker, RESERVED_TICKERS } from "../../../packages/reactor/src/ticker.ts";
import { HttpJsonProvider } from "../../../packages/reactor/src/pricing.ts";
import { rollMarketAggregations, upsertOfficialPool } from "./ingest.ts";

const PORT = Number(process.env.INDEXER_PORT ?? 43148);
const addrs = deployment.addresses as Record<string, string>;
const RPC = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const client = rpcFromEnv(deployment.chainId, RPC);
const sse = new SseHub();
const media = new ObjectStore(new URL("../data/media", import.meta.url).pathname);
const quoteLimit = new RateLimit(60_000, Number(process.env.QUOTE_RPM ?? 60));
const uploadLimit = new RateLimit(60_000, Number(process.env.UPLOAD_RPM ?? 20));
const pricingLimit = new RateLimit(60_000, Number(process.env.PRICING_RPM ?? 30));

const events = [
  parseAbiItem("event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply)"),
  parseAbiItem("event LaunchCreated(address indexed token, uint8 mode, address indexed quote)"),
  parseAbiItem("event InstantLaunchCreated(address indexed token, address indexed quote, address indexed creator, bool rewardsMode, uint256 gradTarget)"),
  parseAbiItem("event InstantMarketOpened(address indexed token, bytes32 indexed poolId, uint256 fdvQuoteRaw, uint256 devBuy)"),
  parseAbiItem("event CurveBuy(address indexed token, address indexed buyer, uint256 quoteIn, uint256 tokensOut, uint256 fee)"),
  parseAbiItem("event CurveSell(address indexed token, address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 fee)"),
  parseAbiItem("event BondingProgress(address indexed token, uint256 realQuote, uint256 gradTarget, uint256 inventory)"),
  parseAbiItem("event GraduationCompleted(address indexed token, bytes32 indexed poolId, uint256 quoteLp, uint256 tokenLp)"),
  parseAbiItem("event OfficialPoolCreated(address indexed token, bytes32 indexed poolId, uint8 mode)"),
  parseAbiItem("event OfficialPoolCreated(bytes32 indexed poolId, address indexed token, address indexed quote)"),
  parseAbiItem("event LaunchAuthorized(address indexed token, string ticker, bytes32 authId, uint32 factoryVersion)"),
  parseAbiItem("event TickerClaimed(string ticker, address indexed token, address indexed factory, uint32 version, uint64 lockedUntil)"),
  parseAbiItem("event TickerPermanentlyLocked(string ticker, address indexed canonicalToken)"),
  parseAbiItem("event SwapFeeAccrued(bytes32 indexed poolId, address indexed quote, uint256 holders, uint256 flywheel, uint256 coreAmt, uint256 notional)"),
  parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"),
  parseAbiItem("event RewardClaimed(address indexed account, address indexed to, uint256 amount)"),
  parseAbiItem("event SelfBurnAccrued(address indexed token, address indexed quote, uint256 amount)"),
  parseAbiItem("event SelfBurnExecuted(address indexed token, uint256 quoteIn, uint256 burned)"),
  parseAbiItem("event FlywheelAccrued(address indexed quote, uint256 amount)"),
  parseAbiItem("event QuoteSettled(address indexed quote, uint256 usdcIn)"),
  parseAbiItem("event EpochSubmitted(uint256 indexed epochId, uint256 n, uint256 pot)"),
  parseAbiItem("event Top10Buy(uint256 indexed epoch, address indexed token, uint256 usdcIn, uint256 burned)"),
  parseAbiItem("event BuybackExecuted(address indexed quote, uint256 quoteIn, uint256 coreOut, address indexed caller)"),
  parseAbiItem("event COREBurned(uint256 amount)"),
];

const factory = addrs.ReactorFactory as `0x${string}`;
const hook = addrs.ReactorHook as `0x${string}`;
const tokenByPool = new Map<string, { token: string; quote: string }>();
const blockTs = new Map<number, number>();
const quoteDec = new Map<string, number>();

async function chainTs(blockNumber: bigint): Promise<number> {
  const n = Number(blockNumber);
  const hit = blockTs.get(n);
  if (hit) return hit;
  const blk = await client.getBlock({ blockNumber });
  const ts = Number(blk.timestamp);
  blockTs.set(n, ts);
  return ts;
}

function json(res: ServerResponse, code: number, body: unknown, rid?: string) {
  res.statusCode = code;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-request-id,authorization,x-ops-token");
  res.setHeader("Content-Type", "application/json");
  if (rid) res.setHeader("x-request-id", rid);
  res.end(JSON.stringify(body));
}

function opsOk(req: IncomingMessage): boolean {
  const token = process.env.OPS_TOKEN;
  if (!token) return process.env.REACTOR_ENV === "LOCAL" || process.env.NODE_ENV !== "production";
  const hdr = String(req.headers["x-ops-token"] ?? req.headers.authorization ?? "");
  return hdr === token || hdr === `Bearer ${token}`;
}

async function tick(store: Store) {
  const head = await client.getBlockNumber();
  const last = BigInt((await getState(store, "block")) ?? "0");
  const lastHash = await getState(store, "block_hash");
  // Arc docs: deterministic BFT finality on commit — no eth-8 confirmation lag.
  const confirmations = BigInt(process.env.ARC_FINALITY_CONFIRMATIONS ?? 0);
  if (last > 0n && lastHash) {
    try {
      const blk = await client.getBlock({ blockNumber: last });
      if (blk.hash && blk.hash !== lastHash) {
        const rewind = last > confirmations ? last - confirmations : 0n;
        await setState(store, "block", rewind.toString());
        await setState(store, "block_hash", "");
        return;
      }
    } catch {
      /* rpc flap — keep cursor */
    }
  }
  let from = last > 0n ? last + 1n : 0n;
  if (from > head) return;
  const to = head - from > 2000n ? from + 2000n : head;
  const watch = [factory, hook, addrs.BuybackVault, addrs.FlywheelVault, addrs.InstantCurve, addrs.SelfBurnVault, addrs.PoolManager, addrs.TickerRegistry]
    .filter(Boolean) as `0x${string}`[];
  const logs = await client.getLogs({ address: watch, events, fromBlock: from, toBlock: to });
  const lastSqrt = new Map<string, string>();

  for (const log of logs) {
    const name = log.eventName ?? "unknown";
    const args = (log.args ?? {}) as Record<string, unknown>;
    const token = String(args.token ?? "");
    const ts = await chainTs(log.blockNumber);
    const tx = log.transactionHash;
    const block = Number(log.blockNumber);
    const logIndex = Number(log.logIndex ?? 0);
    const chainId = deployment.chainId;

    if (name === "TokenCreated") {
      await upsertToken(store, {
        address: token,
        name: String(args.name ?? ""),
        symbol: String(args.symbol ?? ""),
        ticker: String(args.symbol ?? ""),
        supply: String(args.supply ?? ""),
        creator: String(args.creator ?? ""),
        block,
        tx,
        ts,
      });
      sse.publish({ type: "launch", data: { token, name: args.name, symbol: args.symbol, tx } });
    }
    if (name === "LaunchCreated" || name === "InstantLaunchCreated") {
      await upsertToken(store, { address: token, quote: String(args.quote ?? ""), creator: String(args.creator ?? ""), rewardsMode: Boolean(args.rewardsMode ?? true), block, tx, ts });
      await upsertMarket(store, { token, quote: String(args.quote ?? ""), stage: "bonding", gradTarget: String(args.gradTarget ?? ""), ts });
    }
    if (name === "LaunchAuthorized") {
      await upsertToken(store, {
        address: token,
        ticker: String(args.ticker ?? ""),
        factoryVersion: Number(args.factoryVersion ?? 1),
        block,
        tx,
        ts,
      });
    }
    if (name === "TickerClaimed" || name === "TickerPermanentlyLocked") {
      const ticker = String(args.ticker ?? "").toUpperCase();
      await store.run(
        `INSERT INTO tickers(ticker,token,factory,factory_version,locked_until,permanent,reserved)
         VALUES(?,?,?,?,?,?,?) ON CONFLICT(ticker) DO UPDATE SET token=excluded.token, locked_until=excluded.locked_until, permanent=excluded.permanent`,
        ticker,
        String(args.token ?? args.canonicalToken ?? "").toLowerCase(),
        String(args.factory ?? ""),
        Number(args.version ?? 0),
        Number(args.lockedUntil ?? 0),
        name === "TickerPermanentlyLocked" ? 1 : 0,
        name === "TickerPermanentlyLocked" && !args.canonicalToken ? 1 : 0,
      );
    }
    if (name === "OfficialPoolCreated" || name === "GraduationCompleted") {
      const poolId = String(args.poolId ?? "");
      const quoteFromHook = String(args.quote ?? "");
      tokenByPool.set(poolId, { token: token.toLowerCase(), quote: quoteFromHook });
      await upsertOfficialPool(store, {
        poolId,
        token,
        quote: String(args.quote ?? ""),
        factory,
        mode: Number(args.mode ?? (name === "GraduationCompleted" ? 0 : 0)),
        hook: hook ?? "",
        block,
        tx,
        ts,
      });
      await store.run(
        `INSERT INTO pool_relationships(pool_id,token,quote,venue,fee,hooks,exists_onchain,approved,created_block)
         VALUES(?,?,?,?,?,?,1,1,?) ON CONFLICT(pool_id) DO UPDATE SET exists_onchain=1, approved=1, token=excluded.token, quote=COALESCE(NULLIF(excluded.quote,''),pool_relationships.quote)`,
        poolId,
        token.toLowerCase(),
        String(args.quote ?? "").toLowerCase(),
        "OFFICIAL_REACTOR_V4",
        0,
        hook ?? "",
        block,
      );
      await upsertMarket(store, { token, poolId, stage: "v4", marketLive: true, ts });
      const protocol = (addrs.ProtocolV4Adapter ?? addrs.V4Adapter) as `0x${string}` | undefined;
      const user = (addrs.V4Adapter ?? addrs.UniswapV4Adapter) as `0x${string}` | undefined;
      const quote = String(args.quote ?? "");
      if (protocol && quote && hook) {
        const { poolKeyBytes } = await import("./route-graph.ts");
        const data = poolKeyBytes(token as `0x${string}`, quote as `0x${string}`, 0, hook);
        await persistVenue(store, { tokenIn: quote, tokenOut: token, adapter: protocol, kind: "protocol", data, poolId, exists: true, approved: true });
        await persistVenue(store, { tokenIn: token, tokenOut: quote, adapter: protocol, kind: "protocol", data, poolId, exists: true, approved: true });
        if (user) {
          await persistVenue(store, { tokenIn: quote, tokenOut: token, adapter: user, kind: "user", data, poolId, exists: true, approved: true });
          await persistVenue(store, { tokenIn: token, tokenOut: quote, adapter: user, kind: "user", data, poolId, exists: true, approved: true });
        }
      }
      if (name === "GraduationCompleted") {
        await store.run(
          `INSERT INTO graduations(token,pool_id,quote_lp,token_lp,block,tx,ts) VALUES(?,?,?,?,?,?,?)
           ON CONFLICT(token) DO UPDATE SET pool_id=excluded.pool_id`,
          token.toLowerCase(),
          poolId,
          String(args.quoteLp ?? "0"),
          String(args.tokenLp ?? "0"),
          block,
          tx,
          ts,
        );
        sse.publish({ type: "graduation", data: { token, poolId, tx } });
      }
    }
    if (name === "Swap" && args.id && args.sqrtPriceX96) lastSqrt.set(String(args.id), String(args.sqrtPriceX96));
    if (name === "BondingProgress") {
      await store.run(
        `INSERT INTO bonding_states(token,real_quote,grad_target,inventory,ready,graduated,bonding_bps,updated_ts)
         VALUES(?,?,?,?,0,0,0,?) ON CONFLICT(token) DO UPDATE SET real_quote=excluded.real_quote, grad_target=excluded.grad_target, inventory=excluded.inventory, updated_ts=excluded.updated_ts`,
        token.toLowerCase(),
        String(args.realQuote ?? "0"),
        String(args.gradTarget ?? "0"),
        String(args.inventory ?? "0"),
        ts,
      );
      await upsertMarket(store, { token, realQuote: String(args.realQuote ?? "0"), gradTarget: String(args.gradTarget ?? "0"), stage: "bonding", ts });
      sse.publish({ type: "bonding", data: { token, realQuote: args.realQuote, gradTarget: args.gradTarget } });
    }
    if (name === "CurveBuy" || name === "CurveSell") {
      const quoteIn = String(args.quoteIn ?? args.quoteOut ?? "0");
      const tokens = String(args.tokensOut ?? args.tokensIn ?? "0");
      const mkt = await store.get<{ quote: string }>("SELECT quote FROM markets WHERE token=?", token.toLowerCase());
      const q = mkt?.quote ?? "";
      const qDec = quoteDec.get(q) ?? 18;
      const px = curvePriceX18(quoteIn, tokens, qDec, 18);
      await recordTrade(store, sse, {
        block,
        tx,
        logIndex,
        chainId,
        token,
        quote: q,
        side: name === "CurveBuy" ? "buy" : "sell",
        source: "curve",
        amountIn: name === "CurveBuy" ? quoteIn : tokens,
        amountOut: name === "CurveBuy" ? tokens : quoteIn,
        notionalQuote: quoteIn,
        priceQuoteX18: px,
        ts,
      });
    }
    if (name === "SwapFeeAccrued") {
      const poolId = String(args.poolId ?? "");
      const mapped = tokenByPool.get(poolId);
      const q = String(args.quote ?? mapped?.quote ?? "");
      const tok = mapped?.token ?? "";
      const sqrt = lastSqrt.get(poolId) ?? "";
      let px = "0";
      if (sqrt && tok && q) {
        try {
          const tokenIs0 = tok.toLowerCase() < q.toLowerCase();
          px = priceQuoteX18FromSqrt(BigInt(sqrt), tokenIs0, 18, quoteDec.get(q.toLowerCase()) ?? 18).toString();
        } catch {
          px = "0";
        }
      }
      await recordTrade(store, sse, {
        block,
        tx,
        logIndex,
        chainId,
        token: tok,
        quote: q,
        side: "swap",
        source: "v4",
        amountIn: String(args.notional ?? "0"),
        amountOut: "0",
        notionalQuote: String(args.notional ?? "0"),
        priceQuoteX18: px,
        sqrtPrice: sqrt,
        holders: String(args.holders ?? "0"),
        flywheel: String(args.flywheel ?? "0"),
        core: String(args.coreAmt ?? "0"),
        ts,
      });
    }
    if (name === "RewardClaimed") {
      try {
        await store.run("INSERT INTO claims(token,account,amount,block,tx,ts) VALUES(?,?,?,?,?,?)", token.toLowerCase(), String(args.account ?? ""), String(args.amount ?? "0"), block, tx, ts);
        sse.publish({ type: "rewards", data: { token, account: args.account, amount: args.amount, tx } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    if (name === "SelfBurnAccrued" || name === "SelfBurnExecuted") {
      try {
        await store.run("INSERT INTO selfburn(token,quote,amount,burned,kind,block,tx,ts) VALUES(?,?,?,?,?,?,?,?)", token.toLowerCase(), String(args.quote ?? ""), String(args.amount ?? args.quoteIn ?? "0"), String(args.burned ?? "0"), name, block, tx, ts);
        sse.publish({ type: "burn", data: { token, name, tx } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    if (name === "FlywheelAccrued" || name === "QuoteSettled") {
      try {
        await store.run("INSERT INTO flywheel(quote,amount,usdc_in,kind,block,tx,ts) VALUES(?,?,?,?,?,?,?)", String(args.quote ?? "").toLowerCase(), String(args.amount ?? "0"), String(args.usdcIn ?? "0"), name, block, tx, ts);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    if (name === "EpochSubmitted") {
      await store.run(
        `INSERT INTO top10_epochs(epoch_id,pot,n,finalized,paused,reason,ts) VALUES(?,?,?,0,0,'',?)
         ON CONFLICT(epoch_id) DO UPDATE SET pot=excluded.pot, n=excluded.n`,
        String(args.epochId ?? "0"),
        String(args.pot ?? "0"),
        Number(args.n ?? 0),
        ts,
      );
      sse.publish({ type: "top10", data: { epochId: args.epochId, pot: args.pot } });
    }
    if (name === "BuybackExecuted" || name === "COREBurned") {
      try {
        await store.run("INSERT INTO core_buybacks(quote,quote_in,core_out,block,tx,ts) VALUES(?,?,?,?,?,?)", String(args.quote ?? "").toLowerCase(), String(args.quoteIn ?? "0"), String(args.coreOut ?? args.amount ?? "0"), block, tx, ts);
        sse.publish({ type: "core", data: { name, tx } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }
  const headBlk = await client.getBlock({ blockNumber: to });
  await setState(store, "block", to.toString());
  await setState(store, "block_hash", headBlk.hash ?? "");
  await rollMarketAggregations(store);
  await populateExternalPriceMarks(store).catch(() => undefined);
}

async function refreshQuotes(store: Store) {
  const registry = addrs.QuoteAssetRegistry as `0x${string}` | undefined;
  if (!registry) return;
  const registryAbi = [
    { name: "count", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { name: "list", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
    {
      name: "get",
      type: "function",
      stateMutability: "view",
      inputs: [{ type: "address" }],
      outputs: [
        { type: "address" }, { type: "string" }, { type: "string" }, { type: "uint8" }, { type: "string" }, { type: "uint8" },
        { type: "bool" }, { type: "bool" }, { type: "bool" }, { type: "bool" }, { type: "bool" }, { type: "bool" }, { type: "bool" },
      ],
    },
  ] as const;
  try {
    const n = Number(await client.readContract({ address: registry, abi: registryAbi, functionName: "count" }));
    for (let i = 0; i < n; i++) {
      const token = (await client.readContract({ address: registry, abi: registryAbi, functionName: "list", args: [BigInt(i)] })) as `0x${string}`;
      const g = (await client.readContract({ address: registry, abi: registryAbi, functionName: "get", args: [token] })) as readonly unknown[];
      quoteDec.set(token.toLowerCase(), Number(g[3]));
      await store.run(
        `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
         VALUES(?,?,?,?,?,?,?,?,?,'',?)
         ON CONFLICT(token) DO UPDATE SET enabled=excluded.enabled, usd_peg_one=excluded.usd_peg_one, hop_via_usdc=excluded.hop_via_usdc, quarantined=excluded.quarantined`,
        token.toLowerCase(),
        String(g[1]),
        String(g[2]),
        Number(g[3]),
        Number(g[5]),
        Boolean(g[6]) ? 1 : 0,
        Boolean(g[12]) ? 1 : 0,
        Boolean(g[10]) ? 1 : 0,
        Boolean(g[11]) ? 1 : 0,
        Boolean(g[7]) && !Boolean(g[6]) ? 1 : 0,
      );
    }
  } catch (e) {
    await raiseAlert(store, "P1", "quote_refresh", String(e));
  }
}

async function valuationNodes(store: Store): Promise<ValuationService> {
  return loadValuationService(store);
}

async function handle(store: Store, req: IncomingMessage, res: ServerResponse) {
  const rid = requestId({ headers: req.headers as Record<string, string | string[] | undefined> });
  if (req.method === "OPTIONS") {
    json(res, 204, {}, rid);
    return;
  }
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/stream") {
    sse.attach(req, res);
    return;
  }
  if (url.pathname.startsWith("/m/")) {
    const file = media.get(url.pathname.slice(3));
    if (!file) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", file.type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(file.buf);
    return;
  }
  if (url.pathname === "/health") {
    const indexed = Number((await getState(store, "block")) ?? 0);
    const head = await client.getBlockNumber().catch(() => 0n);
    const markets = (await store.get<{ n: number }>("SELECT COUNT(*) as n FROM markets"))?.n ?? 0;
    json(res, 200, { ok: true, block: indexed, head: Number(head), lag: Number(head) - indexed, markets, dialect: store.dialect, network: deployment.network, request_id: rid }, rid);
    return;
  }
  if (url.pathname === "/markets") {
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    const stage = url.searchParams.get("stage") ?? "";
    const quote = url.searchParams.get("quote")?.toLowerCase() ?? "";
    const sort = url.searchParams.get("sort") ?? "new";
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40)));
    const cursorTs = url.searchParams.get("cursor_ts");
    const cursorToken = url.searchParams.get("cursor_token")?.toLowerCase() ?? "";
    const offset = cursorTs == null ? Math.max(0, Number(url.searchParams.get("offset") ?? 0)) : 0;
    const like = `%${q}%`;
    const stageSql = stage === "bonding" ? "bonding" : stage === "v4" || stage === "trending" ? "v4" : "";
    const order =
      sort === "vol"
        ? "CAST(m.volume_24h_usd6 AS NUMERIC) DESC, m.token DESC"
        : sort === "price"
          ? "CAST(m.price_usd6 AS NUMERIC) DESC, m.token DESC"
          : "m.updated_ts DESC, m.token DESC";
    const keyset =
      cursorTs != null
        ? sort === "vol"
          ? " AND (CAST(m.volume_24h_usd6 AS NUMERIC), m.token) < (CAST(? AS NUMERIC), ?)"
          : " AND (m.updated_ts, m.token) < (?, ?)"
        : "";
    const where = `WHERE (?='' OR lower(COALESCE(t.symbol,'')) LIKE ? OR lower(COALESCE(t.name,'')) LIKE ? OR m.token LIKE ? OR lower(COALESCE(t.ticker,'')) LIKE ?)
      AND (?='' OR m.stage=?)
      AND (?='' OR m.quote=?)${keyset}`;
    const params: unknown[] = [q, like, like, like, like, stageSql, stageSql, quote, quote];
    if (cursorTs != null) params.push(cursorTs, cursorToken);
    const total = await store.get<{ n: number }>(
      `SELECT COUNT(*) as n FROM markets m LEFT JOIN tokens t ON t.address=m.token ${where.replace(keyset, "")}`,
      q, like, like, like, like, stageSql, stageSql, quote, quote,
    );
    const items = await store.all<Record<string, unknown>>(
      `SELECT m.token,m.quote,m.pool_id,m.stage,m.market_live,m.fair_id,m.bonding_bps,m.real_quote,m.grad_target,m.price_quote_x18,m.price_usd6,m.fdv_usd6,m.volume_24h_quote,m.volume_24h_usd6,m.trades_24h,m.lifetime_rewards,m.image,m.description,m.updated_ts,
              t.symbol,t.name,t.creator,t.ticker,t.factory_version,t.rewards_mode,t.supply,
              q.symbol as quote_symbol, q.decimals as quote_decimals
       FROM markets m
       LEFT JOIN tokens t ON t.address=m.token
       LEFT JOIN quote_assets q ON q.token=m.quote
       ${where}
       ORDER BY ${order}
       LIMIT ?${cursorTs == null && offset ? " OFFSET ?" : ""}`,
      ...params,
      limit,
      ...(cursorTs == null && offset ? [offset] : []),
    );
    const last = items[items.length - 1];
    json(
      res,
      200,
      {
        items,
        total: Number(total?.n ?? 0),
        next_cursor: last
          ? { cursor_ts: sort === "vol" ? String(last.volume_24h_usd6 ?? "0") : String(last.updated_ts ?? 0), cursor_token: String(last.token ?? "") }
          : null,
        request_id: rid,
      },
      rid,
    );
    return;
  }
  if (url.pathname === "/quote-assets") {
    json(res, 200, { items: await store.all("SELECT * FROM quote_assets WHERE enabled=1"), request_id: rid }, rid);
    return;
  }
  if (url.pathname === "/valuation") {
    const token = url.searchParams.get("token") ?? addrs.USDC;
    const svc = await valuationNodes(store);
    json(res, 200, { ...svc.quoteUsd6(token), usd6: svc.quoteUsd6(token).usd6.toString(), request_id: rid }, rid);
    return;
  }
  if (url.pathname === "/quote" && req.method === "POST") {
    const ip = String(req.socket.remoteAddress ?? "x");
    if (!quoteLimit.allow(ip)) {
      json(res, 429, { error: "rate limited", request_id: rid }, rid);
      return;
    }
    const body = await readBody(req);
    const q = await buildQuote(
      {
        store,
        client,
        addresses: addrs,
        quoteSimulator: (process.env.QUOTE_SIMULATOR as `0x${string}`) ?? "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      },
      body as never,
      rid,
    );
    json(res, q.ok ? 200 : 422, q, rid);
    return;
  }
  if (url.pathname === "/upload" && req.method === "POST") {
    const ip = String(req.socket.remoteAddress ?? "x");
    if (!uploadLimit.allow(ip)) {
      json(res, 429, { error: "rate limited", request_id: rid }, rid);
      return;
    }
    try {
      const max = 2 * 1024 * 1024;
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const c of req) {
        received += (c as Buffer).length;
        if (received > max) {
          req.destroy();
          json(res, 413, { error: "image too large (2MB stream limit)", request_id: rid }, rid);
          return;
        }
        chunks.push(c as Buffer);
      }
      const raw = Buffer.concat(chunks);
      const stored = await media.put(raw, req.headers["content-type"] ?? "application/octet-stream");
      json(res, 200, { ...stored, publicUrl: publicMediaUrl(stored.uri), request_id: rid }, rid);
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : "upload failed", request_id: rid }, rid);
    }
    return;
  }
  const candleMatch = url.pathname.match(/^\/candles\/(0x[a-fA-F0-9]{40})$/);
  if (candleMatch) {
    const interval = (url.searchParams.get("interval") ?? "5m") as keyof typeof CANDLE_INTERVALS;
    const sec = CANDLE_INTERVALS[interval] ?? 300;
    const token = candleMatch[1]!.toLowerCase();
    const limit = Math.min(1_000, Math.max(1, Number(url.searchParams.get("limit") ?? 300)));
    const before = url.searchParams.get("before");
    const after = url.searchParams.get("after");
    const clauses = ["token=?", "interval_sec=?"];
    const params: unknown[] = [token, sec];
    if (before) {
      clauses.push("t<?");
      params.push(Number(before));
    }
    if (after) {
      clauses.push("t>?");
      params.push(Number(after));
    }
    const rows = await store.all<{ t: number; o: string; h: string; l: string; c: string; v: string; n: number }>(
      `SELECT t,o,h,l,c,v,n FROM candles WHERE ${clauses.join(" AND ")} ORDER BY t DESC LIMIT ?`,
      ...params,
      limit,
    );
    rows.reverse();
    const now = Math.floor(Date.now() / 1000);
    const filled = rows.length ? fillContinuous(rows, sec, rows[0]!.t, Math.max(rows[rows.length - 1]!.t, now)) : [];
    json(res, 200, { interval, sec, limit, before, after, candles: filled.slice(-limit), chainTime: true, request_id: rid }, rid);
    return;
  }
  const swapMatch = url.pathname.match(/^\/swaps\/(0x[a-fA-F0-9]{40})$/);
  if (swapMatch) {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200)));
    const beforeId = url.searchParams.get("before_id");
    const clauses = ["token=?"];
    const params: unknown[] = [swapMatch[1]!.toLowerCase()];
    if (beforeId) {
      clauses.push("id<?");
      params.push(Number(beforeId));
    }
    const rows = await store.all(
      `SELECT id, block as t, ts, notional_quote as notional, holders_fee as holders, flywheel_fee as flywheel, core_fee as coreAmt, tx, sqrt_price as sqrtPrice, amount_out as tokensOut, source, price_quote_x18 as px FROM trades WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`,
      ...params,
      limit,
    );
    (rows as Array<Record<string, unknown>>).reverse();
    json(res, 200, rows, rid);
    return;
  }
  if (url.pathname === "/ops") {
    if (!opsOk(req)) {
      json(res, 401, { error: "ops auth required", request_id: rid }, rid);
      return;
    }
    const beatPath = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
    const indexed = Number((await getState(store, "block")) ?? 0);
    const head = await client.getBlockNumber().catch(() => 0n);
    json(
      res,
      200,
      {
        indexer: { block: indexed, head: Number(head), lag: Number(head) - indexed, markets: (await store.get<{ n: number }>("SELECT COUNT(*) as n FROM markets"))?.n, dialect: store.dialect },
        keeper: existsSync(beatPath) ? JSON.parse(readFileSync(beatPath, "utf8")) : null,
        jobs: await store.all("SELECT * FROM keeper_operations ORDER BY ts DESC LIMIT 40"),
        alerts: await recentAlerts(store),
        pricing: { usdPegOneOnly: true, signer: process.env.PRICING_SIGNER_URL ?? "isolated", request_id: rid },
      },
      rid,
    );
    return;
  }
  if (url.pathname === "/keeper") {
    const beatPath = process.env.KEEPER_HEARTBEAT ?? new URL("../data/keeper-heartbeat.json", import.meta.url).pathname;
    json(res, 200, existsSync(beatPath) ? JSON.parse(readFileSync(beatPath, "utf8")) : { ok: false, reason: "no heartbeat" }, rid);
    return;
  }
  if (url.pathname === "/reactor") {
    const rows = await store.all("SELECT * FROM flywheel ORDER BY id DESC LIMIT 40");
    json(res, 200, { events: rows, request_id: rid }, rid);
    return;
  }
  if (url.pathname === "/events") {
    json(res, 200, { sseClients: sse.size, request_id: rid }, rid);
    return;
  }
  const tickerMatch = url.pathname.match(/^\/ticker\/([^/]+)$/);
  if (tickerMatch) {
    const parsed = tryNormalizeTicker(decodeURIComponent(tickerMatch[1] ?? ""));
    if (!parsed.ok) {
      json(res, 400, { error: parsed.reason, request_id: rid }, rid);
      return;
    }
    const row = await store.get<Record<string, unknown>>("SELECT * FROM tickers WHERE ticker=?", parsed.ticker);
    const tok = await store.get<Record<string, unknown>>("SELECT * FROM tokens WHERE ticker=? ORDER BY created_ts DESC", parsed.ticker);
    json(
      res,
      200,
      {
        ticker: parsed.ticker,
        reserved: isReservedTicker(parsed.ticker),
        record: row ?? null,
        token: tok ?? null,
        available:
          !isReservedTicker(parsed.ticker) &&
          (!row || (Number(row.permanent) !== 1 && Number(row.locked_until ?? 0) <= Math.floor(Date.now() / 1000))),
        request_id: rid,
      },
      rid,
    );
    return;
  }
  if (url.pathname === "/launch/admit" && req.method === "POST") {
    const partner = process.env.PARTNER_KEYS;
    if (partner) {
      const key = String(req.headers["x-partner-key"] ?? "");
      if (!partner.split(",").includes(key)) {
        json(res, 401, { error: "partner key required", request_id: rid }, rid);
        return;
      }
    }
    const body = await readBody(req);
    const out = await admit(store, {
      ...body,
      ip: String(req.socket.remoteAddress ?? ""),
      asn: String(body.asn ?? ""),
      session: String(body.session ?? ""),
      client: String(req.headers["user-agent"] ?? ""),
      turnstile: String(body.turnstile ?? body.cfTurnstile ?? ""),
    });
    json(res, out.decision === "DENY" ? 403 : 200, { ...out, request_id: rid, bond: "FUTURE — refundable launch bond is not collected" }, rid);
    return;
  }
  if (url.pathname === "/launch/authorize" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const out = await authorizeLaunch(store, {
        ...body,
        ip: String(req.socket.remoteAddress ?? ""),
        asn: String(body.asn ?? ""),
        session: String(body.session ?? ""),
        client: String(req.headers["user-agent"] ?? ""),
        turnstile: String(body.turnstile ?? body.cfTurnstile ?? ""),
        wallet: String(body.wallet ?? body.creator ?? ""),
        factory: String(body.factory ?? addrs.ReactorFactory ?? ""),
        factoryVersion: Number(body.factoryVersion ?? 1),
        supply: body.supply as string | undefined,
        decimals: body.decimals != null ? Number(body.decimals) : undefined,
        duration: body.duration != null ? Number(body.duration) : undefined,
        auctionBps: body.auctionBps != null ? Number(body.auctionBps) : undefined,
        minRaise: body.minRaise as string | undefined,
        mode: String(body.mode ?? "rewards"),
      });
      json(res, out.status, { ...out.body, request_id: rid }, rid);
    } catch (e) {
      json(res, 503, { error: e instanceof Error ? e.message : "authorize failed", request_id: rid }, rid);
    }
    return;
  }
  if (url.pathname === "/pricing/health") {
    if (!pricingLimit.allow("health")) {
      json(res, 429, { error: "rate limited" }, rid);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const prod = (process.env.REACTOR_ENV ?? "").toUpperCase() === "PROD";
    const providers = [];
    if (process.env.ZEC_HTTP_URL) {
      providers.push(
        new HttpJsonProvider("zec-http", () => process.env.ZEC_HTTP_URL as string, (body) => {
          const n = Number((body as { usd6?: string; price?: number }).usd6 ?? (body as { price?: number }).price);
          if (!Number.isFinite(n) || n <= 0) return null;
          return { usd6: BigInt(Math.round(n)), ts: now };
        }),
      );
    } else if (!prod) {
      providers.push(new StaticProvider("local-static", new Map([["ZEC", { usd6: BigInt(process.env.ZEC_USD6 ?? 50_000_000), ts: now }]])));
    }
    if (prod && providers.length === 0) {
      json(res, 503, { ok: false, error: "static ZEC forbidden in prod — set ZEC_HTTP_URL", request_id: rid }, rid);
      return;
    }
    const fused = await consensusUsd6(providers, "ZEC", now);
    json(res, 200, { ...fused, usd6: fused.usd6.toString(), request_id: rid }, rid);
    return;
  }
  json(res, 404, { error: "not found", request_id: rid }, rid);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function loop(store: Store) {
  try {
    await tick(store);
  } catch (e) {
    console.error("index tick", e);
    await raiseAlert(store, "P1", "index_tick", String(e)).catch(() => undefined);
  }
  setTimeout(() => loop(store), 2500);
}

const store = await openStore();
{
  const now = Math.floor(Date.now() / 1000);
  for (const t of RESERVED_TICKERS) {
    await store.run(
      `INSERT INTO tickers(ticker,token,factory,factory_version,locked_until,permanent,reserved)
       VALUES(?,?,?,?,?,?,?) ON CONFLICT(ticker) DO UPDATE SET permanent=1, reserved=1, locked_until=excluded.locked_until`,
      t,
      "",
      "",
      0,
      2 ** 31 - 1,
      1,
      1,
    );
  }
  void now;
}
{
  const pools = await store.all<{ pool_id: string; token: string; quote: string }>("SELECT pool_id, token, quote FROM pool_relationships");
  for (const p of pools) tokenByPool.set(p.pool_id, { token: p.token, quote: p.quote });
}
await refreshQuotes(store).catch((e) => console.error("quote refresh", e));
setInterval(() => refreshQuotes(store).catch(() => undefined), 60_000);

const server = createServer((req, res) => {
  handle(store, req, res).catch((e) => {
    logLine({ err: String(e), path: req.url });
    json(res, 500, { error: "internal" }, requestId({ headers: req.headers as Record<string, string | string[] | undefined> }));
  });
});
server.listen(PORT, "127.0.0.1", () => {
  logLine({ msg: "indexer listening", port: PORT, dialect: store.dialect });
  loop(store);
});
