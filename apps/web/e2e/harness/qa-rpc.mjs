#!/usr/bin/env node
/**
 * Thin JSON-RPC stub for the UI QA gate.
 * Wagmi/viem probe NEXT_PUBLIC_RPC_URL; the visual artifact does not start Anvil.
 * eth_call fails closed so review fixtures keep owning displayed numbers.
 */
import http from "node:http";
import { LOCAL_CHAIN_ID, RPC_HOST, RPC_PORT } from "./constants.mjs";

const CHAIN_HEX = `0x${LOCAL_CHAIN_ID.toString(16)}`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...CORS,
    ...headers,
  });
  res.end(payload);
}

function reply(id, result) {
  return { jsonrpc: "2.0", id: id ?? 1, result };
}

function fail(id, message) {
  return { jsonrpc: "2.0", id: id ?? 1, error: { code: -32000, message } };
}

function handleOne(req) {
  const method = String(req?.method ?? "");
  const id = req?.id;
  if (method === "eth_chainId" || method === "net_version") return reply(id, CHAIN_HEX);
  if (method === "eth_blockNumber") return reply(id, "0x1");
  if (method === "eth_gasPrice") return reply(id, "0x1");
  if (method === "eth_getBalance") return reply(id, "0x0");
  if (method === "eth_getCode") return reply(id, "0x");
  if (method === "eth_getBlockByNumber" || method === "eth_getBlockByHash") {
    return reply(id, {
      number: "0x1",
      hash: `0x${"11".repeat(32)}`,
      parentHash: `0x${"00".repeat(32)}`,
      timestamp: "0x1",
      transactions: [],
    });
  }
  if (method === "eth_call" || method === "eth_estimateGas") {
    return fail(id, "qa-rpc: no Anvil — review fixtures cover reads");
  }
  return fail(id, `qa-rpc: ${method || "invalid"}`);
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
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${RPC_HOST}:${RPC_PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true, rpc: true, chainId: LOCAL_CHAIN_ID });
    return;
  }

  if (req.method !== "POST") {
    send(res, 404, { error: "not found" });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(String(await readBody(req)));
  } catch {
    send(res, 400, fail(null, "qa-rpc: invalid json"));
    return;
  }

  const out = Array.isArray(parsed) ? parsed.map(handleOne) : handleOne(parsed);
  send(res, 200, out);
});

server.listen(RPC_PORT, RPC_HOST, () => {
  console.log(`[qa-rpc] json-rpc stub :${RPC_PORT} chain ${LOCAL_CHAIN_ID}`);
});
