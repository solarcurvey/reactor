#!/usr/bin/env node
/**
 * Thin indexer/quote mock for the UI QA gate.
 * Shares ports with the #35 production E2E harness (`constants.mjs`).
 */
import http from "node:http";
import { INDEXER_PORT, TOKENS } from "./constants.mjs";

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${INDEXER_PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    json(res, 200, { ok: true, block: 1 });
    return;
  }

  /* Allowed-user baseline for production-like QA snapshots (#65). */
  if (url.pathname === "/operator-policy/status") {
    json(res, 200, {
      ok: true,
      decision: "allow",
      reason: "ALLOW",
      kind: "allow",
      error: "",
      disclaimer:
        "REACTOR-operated services only. Public contracts remain callable onchain. Not a legal or OFAC-compliance opinion.",
      policy: "reactor-operator-policy-v1",
      writesAllowed: true,
      source: "indexer",
    });
    return;
  }

  if (url.pathname === "/markets") {
    json(res, 200, { items: [] });
    return;
  }

  if (url.pathname === "/quote-assets") {
    json(res, 200, { items: [] });
    return;
  }

  const marketOne = /^\/markets\/([^/]+)$/.exec(url.pathname);
  if (marketOne) {
    json(res, 200, { item: null });
    return;
  }

  const pageToken = /^\/page\/token\/([^/]+)$/.exec(url.pathname);
  if (pageToken) {
    json(res, 200, {
      ok: false,
      market: null,
      candles: [],
      swaps: [],
      interval: url.searchParams.get("interval") ?? "5m",
      sparse: true,
    });
    return;
  }

  if (url.pathname === "/quote" && req.method === "POST") {
    await readBody(req);
    json(res, 200, {
      ok: true,
      amountOut: "1000000000000000000",
      minOut: "990000000000000000",
      minQuoteOut: "990000",
      hops: [],
      feeLegs: [],
      aggregateProtocolImpactBps: 350,
      reactorFeeCount: 1,
    });
    return;
  }

  if (url.pathname.startsWith("/ticker/")) {
    const ticker = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    if (!ticker || ticker.length < 2 || /[^A-Z0-9]/.test(ticker)) {
      json(res, 200, { ticker, error: "invalid ticker", available: false });
      return;
    }
    if (ticker === "NEON" || ticker === "USDC") {
      json(res, 200, { ticker, reserved: true, available: false, reservedUntil: Date.now() + 60_000 });
      return;
    }
    json(res, 200, { ticker, reserved: false, available: true, reservedUntil: null });
    return;
  }

  if (url.pathname === "/upload" && req.method === "POST") {
    await readBody(req);
    json(res, 500, { error: "upload failed — no base64 onchain" });
    return;
  }

  if (url.pathname === "/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
      connection: "keep-alive",
    });
    // Same event id twice — the UI must not toast twice.
    res.write(`id: hello-1\nevent: hello\ndata: ${JSON.stringify({ ok: true, token: TOKENS.ZCAT })}\n\n`);
    res.write(`id: hello-1\nevent: hello\ndata: ${JSON.stringify({ ok: true, token: TOKENS.ZCAT })}\n\n`);
    const ping = setInterval(() => {
      res.write(`id: hello-1\nevent: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    }, 15_000);
    req.on("close", () => clearInterval(ping));
    return;
  }

  if (url.pathname.startsWith("/candles/")) {
    json(res, 200, { candles: [], interval: url.searchParams.get("interval") ?? "5m" });
    return;
  }

  if (url.pathname.startsWith("/swaps/")) {
    json(res, 200, []);
    return;
  }

  if (url.pathname === "/reactor") {
    json(res, 200, { events: [] });
    return;
  }

  if (url.pathname === "/top10") {
    json(res, 200, { items: [], epoch: 0 });
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(INDEXER_PORT, "127.0.0.1", () => {
  console.log(`[qa-mock] indexer mock :${INDEXER_PORT}`);
});
