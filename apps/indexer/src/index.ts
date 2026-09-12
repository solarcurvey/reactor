import { parseAbiItem } from "viem";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import deployment from "./deployment.json" with { type: "json" };
import { openStore, type Store } from "./db.ts";
import { rpcFromEnv } from "./rpc.ts";
import { SseHub } from "./sse.ts";
import { ObjectStore, publicMediaUrl } from "./media.ts";
import { RateLimit, SECURITY_HEADERS, logLine, requestId } from "./obs.ts";
import { abortIncoming, BodyTooLargeError, readJsonBody } from "./read-json-body.ts";
import { getState, reconcileCurrentSupplies, rollMarketAggregations, setState } from "./ingest.ts";
import { loadValuationService } from "./valuation-store.ts";
import { populateExternalPriceMarks } from "./price-marks.ts";
import { buildQuote } from "./quote-service.ts";
import { fillCandlesForRequest, CANDLE_INTERVALS } from "../../../packages/reactor/src/prices.ts";
import { listMarkets } from "./markets-query.ts";
import { raiseAlert, recentAlerts } from "./alerts.ts";
import type { ValuationService } from "../../../packages/reactor/src/valuation.ts";
import { persistTickBatch, rewindIndexerCursor } from "./tick-persist.ts";
import { admit, tryNormalizeTicker } from "./admission.ts";
import { authorizeLaunch } from "./authorize.ts";
import { isReservedTicker, RESERVED_TICKERS } from "../../../packages/reactor/src/ticker.ts";
import { consensusForAsset } from "../../../packages/reactor/src/pricing.ts";
import { assetsToPrice, loadPriceRegistry, loadQuoteAssetRows, loadVerifiedVenueUsd6 } from "./price-registry.ts";
import { assertProductionHardGates } from "./prod-gates.ts";
import { assertSharpWorks } from "./sharp-check.ts";

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

const TOKEN_BURN_EVENTS = [
  parseAbiItem("event Burned(address indexed account, uint256 amount)"),
  parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 amount)"),
];

const TOTAL_SUPPLY_ABI = [{ name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;

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
  if (code === 413 || code === 429) res.setHeader("Connection", "close");
  if (rid) res.setHeader("x-request-id", rid);
  res.end(JSON.stringify(body));
}

async function readPublicJson(
  req: IncomingMessage,
  res: ServerResponse,
  rid: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return await readJsonBody(req);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      json(res, 413, { error: e.message, request_id: rid }, rid);
      abortIncoming(req);
      return;
    }
    json(res, 400, { error: "invalid json", request_id: rid }, rid);
    return;
  }
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
        await rewindIndexerCursor(store, rewind.toString());
        return;
      }
    } catch {
      /* rpc flap — keep cursor */
    }
  }
  let from = last > 0n ? last + 1n : 0n;
  const burnedThisTick = new Set<string>();
  const createdThisTick = new Set<string>();
  const coreAddr = String(addrs.CoreToken ?? addrs.TestCORE ?? "").toLowerCase();
  if (from <= head) {
    const to = head - from > 2000n ? from + 2000n : head;
    const watch = [factory, hook, addrs.BuybackVault, addrs.FlywheelVault, addrs.InstantCurve, addrs.SelfBurnVault, addrs.PoolManager, addrs.TickerRegistry]
      .filter(Boolean) as `0x${string}`[];
    const logs = await client.getLogs({ address: watch, events, fromBlock: from, toBlock: to });
    for (const log of logs) {
      if (log.eventName === "TokenCreated") {
        const created = String((log.args as { token?: string } | undefined)?.token ?? "").toLowerCase();
        if (created) createdThisTick.add(created);
      }
    }
    const timestamps = new Map<number, number>();
    const needed = new Set<number>([Number(to)]);
    for (const log of logs) needed.add(Number(log.blockNumber));
    // Watch already-indexed tokens plus TokenCreated in this window so a
    // same-window public burn() is fetched. RPC stays outside persistTickBatch;
    // journal/supply writes share that transaction with the cursor.
    const knownTokens = await store.all<{ address: string }>("SELECT address FROM tokens");
    const burnWatch = [
      ...new Set([...knownTokens.map((r) => r.address.toLowerCase()), ...createdThisTick, coreAddr].filter(Boolean)),
    ] as `0x${string}`[];
    const tokenBurnLogs = burnWatch.length
      ? await client.getLogs({ address: burnWatch, events: TOKEN_BURN_EVENTS, fromBlock: from, toBlock: to })
      : [];
    for (const log of tokenBurnLogs) needed.add(Number(log.blockNumber));
    for (const n of needed) timestamps.set(n, await chainTs(BigInt(n)));
    const headBlk = await client.getBlock({ blockNumber: to });
    const published = await persistTickBatch(store, {
      logs: logs.map((log) => ({
        eventName: log.eventName,
        args: (log.args ?? {}) as Record<string, unknown>,
        address: log.address,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
      })),
      burnLogs: tokenBurnLogs.map((log) => ({
        eventName: log.eventName,
        args: (log.args ?? {}) as Record<string, unknown>,
        address: log.address,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
      })),
      timestamps,
      cursorBlock: to.toString(),
      cursorHash: headBlk.hash ?? "",
      ctx: {
        chainId: deployment.chainId,
        factory,
        hook,
        protocolAdapter: (addrs.ProtocolV4Adapter ?? addrs.V4Adapter) as string | undefined,
        userAdapter: (addrs.V4Adapter ?? addrs.UniswapV4Adapter) as string | undefined,
        tokenByPool,
        quoteDec,
      },
    });
    for (const ev of published) {
      sse.publish(ev);
      if (ev.type === "burn") {
        const token = String((ev.data as { token?: string } | undefined)?.token ?? "").toLowerCase();
        if (token) burnedThisTick.add(token);
      }
    }
    await populateExternalPriceMarks(store).catch(() => undefined);
  }
  const cursor = (await getState(store, "supply_reconcile_cursor")) ?? "";
  const rec = await reconcileCurrentSupplies(
    store,
    async (addr) => {
      try {
        return (await client.readContract({
          address: addr as `0x${string}`,
          abi: TOTAL_SUPPLY_ABI,
          functionName: "totalSupply",
        })) as bigint;
      } catch {
        return null;
      }
    },
    {
      limit: Number(process.env.SUPPLY_RECONCILE_LIMIT ?? 40),
      after: cursor,
      priority: [coreAddr, ...burnedThisTick, ...createdThisTick],
    },
  );
  await setState(store, "supply_reconcile_cursor", rec.nextCursor);
  await rollMarketAggregations(store);
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
    const page = await listMarkets(store, {
      q: url.searchParams.get("q") ?? "",
      stage: url.searchParams.get("stage") ?? "",
      quote: url.searchParams.get("quote") ?? "",
      sort: url.searchParams.get("sort"),
      limit: Number(url.searchParams.get("limit") ?? 40),
      cursorTs: url.searchParams.get("cursor_ts"),
      cursorToken: url.searchParams.get("cursor_token") ?? "",
      offset: Number(url.searchParams.get("offset") ?? 0),
    });
    json(
      res,
      200,
      {
        items: page.items,
        total: page.total,
        sort: page.sort,
        next_cursor: page.next_cursor,
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
    const body = await readPublicJson(req, res, rid);
    if (!body) return;
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
    const filled = fillCandlesForRequest(
      rows,
      sec,
      limit,
      now,
      before != null ? Number(before) : null,
      after != null ? Number(after) : null,
    );
    json(res, 200, { interval, sec, limit, before, after, candles: filled, chainTime: true, request_id: rid }, rid);
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
    const body = await readPublicJson(req, res, rid);
    if (!body) return;
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
    const body = await readPublicJson(req, res, rid);
    if (!body) return;
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
    const registry = loadPriceRegistry();
    const quotes = await loadQuoteAssetRows(store).catch(() => []);
    const assets = assetsToPrice(registry, quotes);
    const usdc = (addrs.USDC ?? "").toLowerCase();
    const rows = [];
    for (const asset of assets) {
      const arcUsd6 = usdc ? await loadVerifiedVenueUsd6(store, asset.token, usdc) : undefined;
      const fused = await consensusForAsset(asset, now, { arcUsd6 });
      rows.push({
        token: asset.token,
        symbol: asset.symbol,
        important: Boolean(asset.important),
        ok: fused.ok,
        usd6: fused.usd6.toString(),
        reason: fused.reason,
        n: fused.n,
        sources: fused.sources,
        observations: fused.observations.map((o) => ({
          source: o.source,
          kind: o.kind,
          ok: o.ok,
          usd6: o.usd6.toString(),
          reason: o.reason,
        })),
      });
    }
    const ok = rows.every((r) => r.ok || !r.important);
    const status = (process.env.REACTOR_ENV ?? "").toUpperCase() === "PROD" && !ok ? 503 : 200;
    json(
      res,
      status,
      {
        ok,
        assets: rows,
        trust: "Offchain multi-source consensus + optional Arc venue sanity. Not an onchain oracle. PROD never uses a static mark.",
        request_id: rid,
      },
      rid,
    );
    return;
  }
  json(res, 404, { error: "not found", request_id: rid }, rid);
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

assertProductionHardGates();
await assertSharpWorks();

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
