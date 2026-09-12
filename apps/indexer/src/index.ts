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
import {
  coreAddressesFromDeployment,
  failClosedTop10,
  persistPausedTop10,
  readTop10Epoch,
  refreshTop10Epoch,
  resolveTop10Serve,
} from "./top10-rank.ts";
import { buildQuote } from "./quote-service.ts";
import { indexCalls, readContractsBatched } from "../../../packages/reactor/src/rpc-batch.ts";
import { getMarket, listMarkets, normalizeMarketToken } from "./markets-query.ts";
import { aggregateTokenPage, listCandles, listSwaps } from "./page-reads.ts";
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
import { indexerSanctionsStore, sanctionsLookup } from "./sanctions.ts";
import {
  CORS_POLICY_HEADERS,
  bindRecoveredIdentity,
  gateProtectedWrite,
  issueOperatorWalletChallenge,
  readOperatorPolicyStatus,
  tryBindOfficialPolicyPlugins,
} from "./operator-policy.ts";
import {
  SANCTIONS_REFRESH_INTERVAL_MS,
  applySanctionsOpsGate,
  createSanctionsOps,
  handleSanctionsOpsRequest,
  isProtectedWritePath,
  protectedAction,
  sanctionsHealthBody,
} from "./sanctions-ops.ts";
import type { SanctionsOps } from "../../../packages/reactor/src/sanctions-ops.ts";

const PORT = Number(process.env.INDEXER_PORT ?? 43148);
/** Exact official-list lookup only. Not a #60 policy gate. */
const sanctions = indexerSanctionsStore();
const addrs = deployment.addresses as Record<string, string>;
const RPC = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const client = rpcFromEnv(deployment.chainId, RPC);
const sse = new SseHub();
const media = new ObjectStore(new URL("../data/media", import.meta.url).pathname);
const quoteLimit = new RateLimit(60_000, Number(process.env.QUOTE_RPM ?? 60));
const uploadLimit = new RateLimit(60_000, Number(process.env.UPLOAD_RPM ?? 20));
const pricingLimit = new RateLimit(60_000, Number(process.env.PRICING_RPM ?? 30));
let sanctionsOps: SanctionsOps;

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
  res.setHeader("Access-Control-Allow-Headers", CORS_POLICY_HEADERS);
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

async function gateWrite(
  req: IncomingMessage,
  body: Record<string, unknown> | undefined,
  rid: string,
  pathname: string,
): Promise<{ status: 403 | 503; body: Record<string, unknown> } | null> {
  if (!isProtectedWritePath(req.method ?? "", pathname)) return null;
  const action = protectedAction(pathname);
  if (!action) return null;
  const gate = await applySanctionsOpsGate({
    ops: sanctionsOps,
    action,
    headers: req.headers,
    body,
    requestId: rid,
  });
  if (gate.ok) return null;
  return { status: gate.status, body: { ...gate.body, request_id: rid } };
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
  try {
    await refreshTop10Epoch(store, { coreAddresses: coreAddressesFromDeployment(addrs) });
  } catch (e) {
    await raiseAlert(store, "P1", "top10_rank", String(e));
    await persistPausedTop10(store, String(e)).catch(() => undefined);
  }
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
    const listed = n > 0
      ? await readContractsBatched<`0x${string}`>(client, indexCalls(registry, registryAbi, "list", n))
      : [];
    const assets = listed.length
      ? await readContractsBatched<readonly unknown[]>(
          client,
          listed.map((token) => ({ address: registry, abi: registryAbi, functionName: "get", args: [token] })),
        )
      : [];
    for (let i = 0; i < listed.length; i++) {
      const token = listed[i]!;
      const g = assets[i] ?? [];
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
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(file.buf);
    return;
  }
  if (url.pathname === "/sanctions/screen" || url.pathname === "/sanctions/dataset") {
    const out = sanctionsLookup(sanctions, { method: req.method, pathname: url.pathname, searchParams: url.searchParams });
    json(res, out.status, { ...out.body, request_id: rid }, rid);
    return;
  }
  if (url.pathname === "/sanctions/health") {
    const out = handleSanctionsOpsRequest(sanctionsOps, { method: req.method, pathname: url.pathname });
    json(res, out?.status ?? 405, { ...(out?.body ?? { error: "method not allowed" }), request_id: rid }, rid);
    return;
  }
  if (url.pathname.startsWith("/ops/sanctions/") && req.method === "POST") {
    if (!opsOk(req)) {
      json(res, 401, { error: "ops auth required", request_id: rid }, rid);
      return;
    }
    if (url.pathname === "/ops/sanctions/refresh") {
      const result = await sanctionsOps.refresh();
      json(res, result.ok ? 200 : 422, { ...result, health: sanctionsHealthBody(sanctionsOps), request_id: rid }, rid);
      return;
    }
    const body = await readPublicJson(req, res, rid);
    if (!body) return;
    const out = handleSanctionsOpsRequest(sanctionsOps, {
      method: req.method,
      pathname: url.pathname,
      headers: req.headers,
      body,
      opsAuthorized: true,
    });
    json(res, out?.status ?? 404, { ...(out?.body ?? { error: "not found" }), request_id: rid }, rid);
    return;
  }
  if (url.pathname === "/operator-policy/challenge") {
    const issued = issueOperatorWalletChallenge();
    if ("error" in issued) {
      json(res, 503, { error: issued.error, request_id: rid }, rid);
      return;
    }
    json(res, 200, { ...issued, request_id: rid }, rid);
    return;
  }
  if (url.pathname === "/operator-policy/status") {
    const out = await readOperatorPolicyStatus({ headers: req.headers });
    json(res, out.status, { ...out.body, request_id: rid }, rid);
    return;
  }
  if (url.pathname === "/health") {
    const indexed = Number((await getState(store, "block")) ?? 0);
    const head = await client.getBlockNumber().catch(() => 0n);
    const markets = (await store.get<{ n: number }>("SELECT COUNT(*) as n FROM markets"))?.n ?? 0;
    json(res, 200, { ok: true, block: indexed, head: Number(head), lag: Number(head) - indexed, markets, dialect: store.dialect, network: deployment.network, sanctions: sanctionsHealthBody(sanctionsOps), request_id: rid }, rid);
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
  const marketOne = url.pathname.match(/^\/markets\/(0x[a-fA-F0-9]{40})$/);
  if (marketOne) {
    const token = normalizeMarketToken(marketOne[1]);
    if (!token) {
      json(res, 400, { error: "invalid token", request_id: rid }, rid);
      return;
    }
    const item = await getMarket(store, token);
    if (!item) {
      json(res, 404, { error: "market not found", token, request_id: rid }, rid);
      return;
    }
    json(res, 200, { item, request_id: rid }, rid);
    return;
  }
  const tokenPage = url.pathname.match(/^\/page\/token\/(0x[a-fA-F0-9]{40})$/);
  if (tokenPage) {
    const page = await aggregateTokenPage(store, tokenPage[1] ?? "", {
      interval: url.searchParams.get("interval"),
      candleLimit: Number(url.searchParams.get("candle_limit") ?? 300),
      swapLimit: Number(url.searchParams.get("swap_limit") ?? 200),
    });
    if (!page.ok) {
      json(res, page.reason === "invalid token" ? 400 : 404, { error: page.reason, request_id: rid }, rid);
      return;
    }
    json(res, 200, { ...page, request_id: rid }, rid);
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
  if (url.pathname === "/top10") {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const persisted = await readTop10Epoch(store);
      const payload = await resolveTop10Serve({
        persisted,
        nowSec,
        refresh: () => refreshTop10Epoch(store, { coreAddresses: coreAddressesFromDeployment(addrs), nowSec }),
      });
      json(res, 200, { ...payload, request_id: rid }, rid);
    } catch (e) {
      json(res, 200, { ...failClosedTop10(e instanceof Error ? e.message : "top10 failed — epoch paused"), request_id: rid }, rid);
    }
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
    const gate = await gateProtectedWrite({ headers: req.headers, body, surface: "quote" });
    if (!gate.ok) {
      json(res, gate.status, { ...gate.body, request_id: rid }, rid);
      return;
    }
    bindRecoveredIdentity(body, gate.wallet);
    const freshness = await gateWrite(req, body, rid, url.pathname);
    if (freshness) {
      json(res, freshness.status, freshness.body, rid);
      return;
    }
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
    const gate = await gateProtectedWrite({ headers: req.headers, surface: "upload" });
    if (!gate.ok) {
      json(res, gate.status, { ...gate.body, request_id: rid }, rid);
      return;
    }
    const ip = String(req.socket.remoteAddress ?? "x");
    if (!uploadLimit.allow(ip)) {
      json(res, 429, { error: "rate limited", request_id: rid }, rid);
      return;
    }
    const gated = await gateWrite(req, undefined, rid, url.pathname);
    if (gated) {
      json(res, gated.status, gated.body, rid);
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
      json(res, 200, { ...stored, publicUrl: publicMediaUrl(stored.uri), wallet: gate.wallet, request_id: rid }, rid);
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : "upload failed", request_id: rid }, rid);
    }
    return;
  }
  const candleMatch = url.pathname.match(/^\/candles\/(0x[a-fA-F0-9]{40})$/);
  if (candleMatch) {
    const body = await listCandles(store, candleMatch[1] ?? "", {
      interval: url.searchParams.get("interval"),
      limit: Number(url.searchParams.get("limit") ?? 300),
      before: url.searchParams.get("before"),
      after: url.searchParams.get("after"),
    });
    if (!body) {
      json(res, 400, { error: "invalid token", request_id: rid }, rid);
      return;
    }
    json(res, 200, { ...body, chainTime: true, request_id: rid }, rid);
    return;
  }
  const swapMatch = url.pathname.match(/^\/swaps\/(0x[a-fA-F0-9]{40})$/);
  if (swapMatch) {
    const rows = await listSwaps(store, swapMatch[1] ?? "", {
      limit: Number(url.searchParams.get("limit") ?? 200),
      beforeId: url.searchParams.get("before_id"),
    });
    if (!rows) {
      json(res, 400, { error: "invalid token", request_id: rid }, rid);
      return;
    }
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
        sanctions: sanctionsHealthBody(sanctionsOps),
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
    const gate = await gateProtectedWrite({ headers: req.headers, body, surface: "launch.admit" });
    if (!gate.ok) {
      json(res, gate.status, { ...gate.body, request_id: rid }, rid);
      return;
    }
    bindRecoveredIdentity(body, gate.wallet);
    const freshness = await gateWrite(req, body, rid, url.pathname);
    if (freshness) {
      json(res, freshness.status, freshness.body, rid);
      return;
    }
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
    const gate = await gateProtectedWrite({ headers: req.headers, body, surface: "launch.authorize" });
    if (!gate.ok) {
      json(res, gate.status, { ...gate.body, request_id: rid }, rid);
      return;
    }
    bindRecoveredIdentity(body, gate.wallet);
    const freshness = await gateWrite(req, body, rid, url.pathname);
    if (freshness) {
      json(res, freshness.status, freshness.body, rid);
      return;
    }
    try {
      const out = await authorizeLaunch(store, {
        ...body,
        ip: String(req.socket.remoteAddress ?? ""),
        asn: String(body.asn ?? ""),
        session: String(body.session ?? ""),
        client: String(req.headers["user-agent"] ?? ""),
        turnstile: String(body.turnstile ?? body.cfTurnstile ?? ""),
        wallet: gate.wallet,
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
await tryBindOfficialPolicyPlugins();

const store = await openStore();
sanctionsOps = await createSanctionsOps(store);
{
  const start = await sanctionsOps.startup();
  logLine({
    msg: "sanctions-ops startup",
    freshness: start.health.freshness,
    dataset: start.health.dataset.versionId,
    degraded: start.health.degraded,
    refreshOk: start.refresh?.ok ?? null,
  });
}
setInterval(() => {
  sanctionsOps.refresh().catch((e) => logLine({ err: String(e), path: "sanctions-refresh" }));
}, Number(process.env.SANCTIONS_REFRESH_INTERVAL_MS ?? SANCTIONS_REFRESH_INTERVAL_MS));
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
