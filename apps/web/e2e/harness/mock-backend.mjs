#!/usr/bin/env node
/**
 * Deterministic JSON-RPC + indexer mock for the production UI E2E gate.
 * No Anvil, no mainnet keys, no isolated signer. Frozen 3.5% / 2/1/0.5 copy only.
 */
import { createServer } from "node:http";
import { ADDR, ANVIL_ACCOUNT_0, INDEXER_PORT, LOCAL_CHAIN_HEX, RPC_PORT, TOKENS } from "./constants.mjs";

const receipts = new Map();
const delayed = new Map();
let blockNumber = 16;
let control = {
  allowance: null,
  balance: null,
  receipt: "instant",
  delayMs: 400,
  launchAuth: "ok",
};

function resetControl() {
  control = { allowance: null, balance: null, receipt: "instant", delayMs: 400, launchAuth: "ok" };
  receipts.clear();
  delayed.clear();
}

function allowOrigin(req) {
  const origin = req?.headers?.origin;
  return typeof origin === "string" && origin.length > 0 ? origin : "*";
}

function cors(res, req) {
  res.setHeader("Access-Control-Allow-Origin", allowOrigin(req));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function encodeUint(n) {
  return "0x" + BigInt(n).toString(16).padStart(64, "0");
}

function hexQty(n) {
  return "0x" + BigInt(n).toString(16);
}

function emptyBloom() {
  return "0x" + "00".repeat(256);
}

function latestBlock() {
  return {
    number: hexQty(blockNumber),
    hash: "0x" + "11".repeat(32),
    parentHash: "0x" + "22".repeat(32),
    timestamp: hexQty(Math.floor(Date.now() / 1000)),
    transactions: [],
    miner: ANVIL_ACCOUNT_0,
    gasLimit: "0x1c9c380",
    gasUsed: "0x5208",
    baseFeePerGas: "0x1",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    nonce: "0x0000000000000000",
    sha3Uncles: "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
    receiptsRoot: "0x" + "00".repeat(32),
    stateRoot: "0x" + "00".repeat(32),
    transactionsRoot: "0x" + "00".repeat(32),
    logsBloom: emptyBloom(),
    uncles: [],
    size: "0x200",
    mixHash: "0x" + "00".repeat(32),
  };
}

function handleEthCall(data) {
  const hex = (data ?? "0x").replace(/^0x/i, "");
  const sel = hex.slice(0, 8).toLowerCase();
  if (sel === "313ce567") return encodeUint(18); // decimals()
  // 2-address reads (allowance)
  if (hex.length >= 136) {
    if (control.allowance != null) return encodeUint(control.allowance);
    return encodeUint((1n << 256n) - 1n);
  }
  // 1-address reads (balanceOf / pendingRewards)
  if (hex.length >= 72) {
    if (control.balance != null) return encodeUint(control.balance);
    return encodeUint(5_000_000n);
  }
  return null;
}

function jsonRpc(req) {
  const id = req.id ?? 1;
  const method = req.method;
  const params = req.params ?? [];
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (message, code = -32603) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "eth_chainId":
    case "net_version":
      return ok(method === "eth_chainId" ? LOCAL_CHAIN_HEX : String(5042002));
    case "eth_blockNumber":
      blockNumber += 1;
      return ok(hexQty(blockNumber));
    case "eth_gasPrice":
    case "eth_maxPriorityFeePerGas":
      return ok("0x3b9aca00");
    case "eth_estimateGas":
      return ok("0x30d40");
    case "eth_getBalance":
      return ok(encodeUint(10n ** 24n));
    case "eth_getCode":
      return ok("0x6080604052");
    case "eth_syncing":
      return ok(false);
    case "eth_getBlockByNumber":
    case "eth_getBlockByHash":
      return ok(latestBlock());
    case "eth_call": {
      const data = params[0]?.data ?? params[0]?.input ?? "0x";
      const result = handleEthCall(data);
      if (result === null) return err("execution reverted", 3);
      return ok(result);
    }
    case "eth_getTransactionReceipt": {
      const hash = String(params[0] ?? "");
      if (!hash || hash === "0x") return ok(null);
      const key = hash.toLowerCase();
      if (control.receipt === "drop") return ok(null);
      if (delayed.has(key)) {
        const d = delayed.get(key);
        if (Date.now() < d.readyAt) return ok(null);
        receipts.set(key, d.rec);
        delayed.delete(key);
        blockNumber += 1;
        return ok(d.rec);
      }
      if (receipts.has(key)) return ok(receipts.get(key));
      if (control.receipt === "delay") {
        const rec = makeReceipt(key, ANVIL_ACCOUNT_0, ADDR.ReactorRouter, "0x1");
        delayed.set(key, { readyAt: Date.now() + Number(control.delayMs ?? 400), rec });
        return ok(null);
      }
      putReceipt(key, ANVIL_ACCOUNT_0, ADDR.ReactorRouter, control.receipt === "revert" ? "0x0" : "0x1");
      return ok(receipts.get(key));
    }
    case "eth_getTransactionByHash": {
      const hash = String(params[0] ?? "").toLowerCase();
      if (!hash || hash === "0x") return ok(null);
      if (control.receipt === "drop") return ok(null);
      const pending = {
        hash,
        nonce: "0x1",
        blockHash: null,
        blockNumber: null,
        transactionIndex: null,
        from: ANVIL_ACCOUNT_0,
        to: ADDR.ReactorRouter,
        value: "0x0",
        gas: "0x30d40",
        gasPrice: "0x3b9aca00",
        input: "0x",
        v: "0x1",
        r: "0x" + "11".repeat(32),
        s: "0x" + "22".repeat(32),
      };
      if (control.receipt === "delay" && !receipts.has(hash)) return ok(pending);
      if (!receipts.has(hash)) putReceipt(hash, ANVIL_ACCOUNT_0, ADDR.ReactorRouter);
      const r = receipts.get(hash);
      return ok({
        ...pending,
        hash: r.transactionHash,
        blockHash: r.blockHash,
        blockNumber: r.blockNumber,
        transactionIndex: r.transactionIndex,
        from: r.from,
        to: r.to,
      });
    }
    case "eth_sendRawTransaction": {
      const hash = "0x" + String(receipts.size + 1).padStart(64, "0");
      putReceipt(hash, ANVIL_ACCOUNT_0, ADDR.ReactorRouter);
      return ok(hash);
    }
    default:
      return err(`unsupported ${method}`, -32601);
  }
}

function makeReceipt(hash, from, to, status = "0x1") {
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: "0x" + "11".repeat(32),
    blockNumber: hexQty(blockNumber),
    from,
    to,
    gasUsed: "0x5208",
    cumulativeGasUsed: "0x5208",
    contractAddress: null,
    logs: [],
    logsBloom: emptyBloom(),
    status,
    effectiveGasPrice: "0x3b9aca00",
    type: "0x2",
  };
}

function putReceipt(hash, from, to, status = "0x1") {
  const rec = makeReceipt(hash, from, to, status);
  receipts.set(hash.toLowerCase(), rec);
  blockNumber += 1;
}

function feeLegs(kind, token) {
  const nested = kind === "BUY" || kind === "SELL";
  const cat = String(token).toLowerCase() === TOKENS.CAT.toLowerCase();
  if (cat && nested) {
    return {
      feeLegs: [
        {
          reactorOfficial: true,
          protocolFeeBps: 350,
          venue: "OFFICIAL_REACTOR_V4",
          tokenIn: ADDR.ZEC,
          tokenOut: TOKENS.ZCAT,
          notionalQuote: "100000000",
          holders: "2000000",
          flywheel: "1000000",
          core: "500000",
          quoteToken: ADDR.ZEC,
          quoteDecimals: 8,
          quoteSymbol: "ZEC",
        },
        {
          reactorOfficial: true,
          protocolFeeBps: 350,
          venue: "BONDING_CURVE",
          tokenIn: TOKENS.ZCAT,
          tokenOut: TOKENS.CAT,
          notionalQuote: "965000000000000000",
          holders: "19300000000000000",
          flywheel: "9650000000000000",
          core: "4825000000000000",
          quoteToken: TOKENS.ZCAT,
          quoteDecimals: 18,
          quoteSymbol: "ZCAT",
        },
      ],
      aggregateProtocolImpactBps: 688,
      reactorFeeCount: 2,
    };
  }
  const quoteToken = String(token).toLowerCase() === TOKENS.ZCAT.toLowerCase() ? ADDR.ZEC : ADDR.USDC;
  const quoteDecimals = quoteToken === ADDR.ZEC ? 8 : 6;
  const quoteSymbol = quoteDecimals === 8 ? "ZEC" : "USDC";
  return {
    feeLegs: [
      {
        reactorOfficial: true,
        protocolFeeBps: 350,
        venue: String(token).toLowerCase() === TOKENS.ZCAT.toLowerCase() ? "OFFICIAL_REACTOR_V4" : "BONDING_CURVE",
        tokenIn: kind === "BUY" ? quoteToken : token,
        tokenOut: kind === "BUY" ? token : quoteToken,
        notionalQuote: quoteDecimals === 8 ? "100000000" : "1000000",
        holders: quoteDecimals === 8 ? "2000000" : "20000",
        flywheel: quoteDecimals === 8 ? "1000000" : "10000",
        core: quoteDecimals === 8 ? "500000" : "5000",
        quoteToken,
        quoteDecimals,
        quoteSymbol,
      },
    ],
    aggregateProtocolImpactBps: 350,
    reactorFeeCount: 1,
  };
}

function quoteTicket(body) {
  const kind = String(body.kind ?? "BUY").toUpperCase();
  const token = body.token ?? TOKENS.ZCAT;
  const buy = kind === "BUY";
  const amountOut = buy ? (10n ** 18n).toString() : "990000";
  const minOut = buy ? ((10n ** 18n * 99n) / 100n).toString() : "980100";
  const hops =
    String(body.tokenIn ?? "").toLowerCase() === ADDR.USDC.toLowerCase() ||
    String(body.tokenOut ?? "").toLowerCase() === ADDR.USDC.toLowerCase()
      ? [
          {
            adapter: ADDR.V4Adapter,
            tokenIn: buy ? ADDR.USDC : token,
            tokenOut: buy ? ADDR.ZEC : ADDR.USDC,
            minOut: "1",
            data: "0x",
          },
          {
            adapter: ADDR.V4Adapter,
            tokenIn: buy ? ADDR.ZEC : ADDR.ZEC,
            tokenOut: buy ? token : ADDR.USDC,
            minOut: "1",
            data: "0x",
          },
        ]
      : [];
  return {
    ok: true,
    amountOut,
    minOut,
    minQuoteOut: buy ? minOut : "980100",
    hops,
    ...feeLegs(kind, token),
  };
}

const BILLION = "1000000000000000000000000000";

function marketRow(partial) {
  return {
    token: partial.token,
    quote: partial.quote,
    creator: partial.creator ?? ANVIL_ACCOUNT_0,
    fair_id: partial.fair_id ?? "0",
    market_live: partial.market_live ?? 0,
    stage: partial.stage ?? (partial.market_live ? "graduated" : "bonding"),
    bonding_bps: partial.bonding_bps ?? 0,
    real_quote: partial.real_quote ?? "10",
    grad_target: partial.grad_target ?? "20",
    symbol: partial.symbol,
    name: partial.name,
    ticker: partial.ticker ?? partial.symbol,
    decimals: 18,
    current_supply: BILLION,
    supply: BILLION,
    quote_symbol: partial.quote_symbol,
    quote_decimals: partial.quote_decimals,
    lifetime_rewards: partial.lifetime_rewards ?? "0",
    rewards_mode: partial.rewards_mode ?? 1,
    price_quote_x18: partial.price_quote_x18 ?? "20000000000000000",
    fdv_usd6: partial.fdv_usd6 ?? "412000000000",
    volume_24h_usd6: partial.volume_24h_usd6 ?? "88000000000",
    image: partial.image ?? "/icons/usdc.svg",
    description: partial.description ?? "",
  };
}

/** Same fixture set as `review-fixtures.ts`, shaped as #50 indexer market rows. */
const MARKETS = [
  marketRow({
    token: TOKENS.ZCAT,
    quote: ADDR.ZEC,
    name: "Zcash Cat",
    symbol: "ZCAT",
    market_live: 1,
    stage: "graduated",
    quote_symbol: "ZEC",
    quote_decimals: 8,
    image: "/icons/zec.svg",
    lifetime_rewards: "11564651717",
  }),
  marketRow({
    token: TOKENS.GIGA,
    quote: ADDR.USDC,
    name: "Giga",
    symbol: "GIGA",
    market_live: 1,
    stage: "graduated",
    quote_symbol: "USDC",
    quote_decimals: 6,
  }),
  marketRow({
    token: TOKENS.FCAT,
    quote: ADDR.ZEC,
    name: "Fair Cat",
    symbol: "FCAT",
    fair_id: "1",
    stage: "fair",
    quote_symbol: "ZEC",
    quote_decimals: 8,
    image: "/icons/zec.svg",
  }),
  marketRow({
    token: TOKENS.NEON,
    quote: ADDR.USDC,
    name: "Neon",
    symbol: "NEON",
    stage: "bonding",
    bonding_bps: 1640,
    quote_symbol: "USDC",
    quote_decimals: 6,
  }),
  marketRow({
    token: TOKENS.CAT,
    quote: TOKENS.ZCAT,
    name: "Cat",
    symbol: "CAT",
    stage: "bonding",
    bonding_bps: 4120,
    quote_symbol: "ZCAT",
    quote_decimals: 18,
  }),
  marketRow({
    token: TOKENS.BOND,
    quote: ADDR.USDC,
    name: "Bond",
    symbol: "BOND",
    stage: "bonding",
    bonding_bps: 6100,
    quote_symbol: "USDC",
    quote_decimals: 6,
  }),
  marketRow({
    token: TOKENS.RDY,
    quote: ADDR.USDC,
    name: "Ready",
    symbol: "RDY",
    stage: "ready",
    bonding_bps: 10_000,
    quote_symbol: "USDC",
    quote_decimals: 6,
  }),
];

function findMarket(addr) {
  const a = String(addr ?? "").toLowerCase();
  return MARKETS.find((m) => m.token.toLowerCase() === a);
}

const QUOTE_ASSETS = [
  {
    token: ADDR.USDC,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    category: 4,
    enabled: 1,
    usd_peg_one: 1,
    exists: 1,
  },
  {
    token: ADDR.ZEC,
    symbol: "ZEC",
    name: "Zcash",
    decimals: 8,
    category: 1,
    enabled: 1,
    usd_peg_one: 0,
    exists: 1,
  },
];

/** #68 write paths fetch this before quote / launch-pricing / upload. */
function operatorPolicyChallenge() {
  const exp = Math.floor(Date.now() / 1000) + 120;
  return {
    token: `e2e.5042002.${exp}.nonce.deadbeef`,
    message: [
      "REACTOR operator-policy v1",
      "purpose: operator-policy-write",
      "chainId: 5042002",
      "nonce: e2e",
      `exp: ${exp}`,
    ].join("\n"),
    exp,
    nonce: "e2e",
    chainId: 5042002,
  };
}

function launchAuth(body) {
  const creator = body.creator ?? body.wallet ?? ANVIL_ACCOUNT_0;
  const ticker = String(body.ticker ?? "E2E").toUpperCase();
  return {
    decision: "ALLOW",
    ticker,
    auth: {
      factory: ADDR.ReactorFactory,
      factoryVersion: 1,
      creator,
      quote: body.quote ?? ADDR.USDC,
      quoteDecimals: 6,
      mode: body.mode === "fair" ? 1 : 0,
      ticker,
      name: body.name ?? ticker,
      metadataHash: "0x" + "11".repeat(32),
      virtualQuote0: "5000000000",
      curveConfig: "0x" + "22".repeat(32),
      authId: "0x" + "33".repeat(32),
      deadline: String(Math.floor(Date.now() / 1000) + 600),
    },
    signature: "0x" + "ab".repeat(65),
  };
}

function handleIndexer(req, res, url, bodyText) {
  cors(res, req);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, block: blockNumber, e2e: true }));
    return;
  }
  if (url.pathname === "/operator-policy/challenge") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(operatorPolicyChallenge()));
    return;
  }
  if (url.pathname === "/operator-policy/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ decision: "ALLOW", reason: "E2E_LOCAL", request_id: "e2e" }));
    return;
  }
  // Keep-alive hello so the live-toast EventSource is not a 404 console.error.
  if (url.pathname === "/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": allowOrigin(req),
      Vary: "Origin",
    });
    res.write(`event: hello\nid: 1\ndata: ${JSON.stringify({ ok: true, last: 0, head: 1 })}\n\n`);
    const ping = setInterval(() => {
      res.write("event: ping\ndata: {}\n\n");
    }, 15_000);
    req.on("close", () => clearInterval(ping));
    return;
  }
  if (url.pathname === "/quote-assets") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: QUOTE_ASSETS }));
    return;
  }
  const marketOne = url.pathname.match(/^\/markets\/(0x[a-fA-F0-9]{40})$/i);
  if (marketOne) {
    const item = findMarket(marketOne[1]);
    if (!item) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "market not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ item }));
    return;
  }
  const tokenPage = url.pathname.match(/^\/page\/token\/(0x[a-fA-F0-9]{40})$/i);
  if (tokenPage) {
    const market = findMarket(tokenPage[1]);
    if (!market) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "market not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        token: market.token,
        market,
        candles: [],
        interval: url.searchParams.get("interval") ?? "5m",
        sparse: true,
        swaps: [],
      }),
    );
    return;
  }
  if (url.pathname === "/markets") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: MARKETS }));
    return;
  }
  if (url.pathname === "/quote" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse(bodyText || "{}");
    } catch {
      body = {};
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(quoteTicket(body)));
    return;
  }
  if (url.pathname === "/e2e/control") {
    if (req.method === "POST") {
      let body = {};
      try {
        body = JSON.parse(bodyText || "{}");
      } catch {
        body = {};
      }
      if (body.reset) resetControl();
      if (body.allowance !== undefined) control.allowance = body.allowance;
      if (body.balance !== undefined) control.balance = body.balance;
      if (body.receipt) control.receipt = body.receipt;
      if (body.delayMs != null) control.delayMs = Number(body.delayMs);
      if (body.launchAuth) control.launchAuth = body.launchAuth;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, control }));
    return;
  }
  if (url.pathname === "/launch/authorize" && req.method === "POST") {
    if (control.launchAuth === "fail") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "launch authorization unavailable — admission/signer down", needsAuth: true }));
      return;
    }
    let body = {};
    try {
      body = JSON.parse(bodyText || "{}");
    } catch {
      body = {};
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(launchAuth(body)));
    return;
  }
  if (url.pathname.startsWith("/ticker/")) {
    const raw = decodeURIComponent(url.pathname.slice("/ticker/".length));
    const ticker = raw.toUpperCase();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ticker, reserved: ticker === "CORE", available: ticker !== "CORE" }));
    return;
  }
  if (url.pathname === "/upload" && req.method === "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ publicUrl: "/m/e2e.webp", uri: "/m/e2e.webp" }));
    return;
  }
  if (url.pathname.startsWith("/candles/") || url.pathname.startsWith("/swaps/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(url.pathname.startsWith("/candles/") ? JSON.stringify({ candles: [], interval: "5m" }) : JSON.stringify([]));
    return;
  }
  if (url.pathname === "/reactor" || url.pathname === "/top10") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(url.pathname === "/top10" ? JSON.stringify({ ranks: [] }) : JSON.stringify({ events: [] }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "e2e mock: not found" }));
}

function handleRpc(req, res, bodyText) {
  cors(res, req);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyText || "{}");
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid json" }));
    return;
  }
  const out = Array.isArray(parsed) ? parsed.map(jsonRpc) : jsonRpc(parsed);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(out));
}

const rpc = createServer(async (req, res) => {
  try {
    const body = req.method === "POST" ? await readBody(req) : "";
    handleRpc(req, res, body);
  } catch (e) {
    cors(res, req);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "rpc fail" }));
  }
});

const indexer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", INDEXER_URL_PLACEHOLDER);
    const body = req.method === "POST" ? await readBody(req) : "";
    handleIndexer(req, res, url, body);
  } catch (e) {
    cors(res, req);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "indexer fail" }));
  }
});

const INDEXER_URL_PLACEHOLDER = `http://127.0.0.1:${INDEXER_PORT}`;

function listen(server, port, name) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`[e2e-mock] ${name} http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

await listen(rpc, RPC_PORT, "rpc");
await listen(indexer, INDEXER_PORT, "indexer");

function shutdown() {
  rpc.close();
  indexer.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
