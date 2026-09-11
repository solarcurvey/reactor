/**
 * Isolated launch-pricing signer. Never import this from Next.
 * FAIL closed if key missing. Anvil key only when REACTOR_ENV=LOCAL.
 */
import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, parseAbi } from "viem";
import { defineChain } from "viem";
import deployment from "./deployment.json" with { type: "json" };
import { RateLimit, SECURITY_HEADERS, logLine, requestId } from "./obs.ts";
import { valueQuoteUsd6, type QuoteNode } from "../../../packages/reactor/src/valuation.ts";
import { fuseExternalUsd6 } from "../../../packages/reactor/src/valuation.ts";

const PORT = Number(process.env.PRICING_SIGNER_PORT ?? 43149);
const LOCAL = (process.env.REACTOR_ENV ?? "").toUpperCase() === "LOCAL";
const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const addrs = deployment.addresses as Record<string, string>;
const limit = new RateLimit(60_000, Number(process.env.PRICING_RPM ?? 30));

function resolveKey(): `0x${string}` {
  const env = process.env.PRICING_SIGNER_PK;
  if (env && env.length >= 10) return env as `0x${string}`;
  if (LOCAL && deployment.chainId === 5042002) return ANVIL0;
  throw new Error("PRICING_SIGNER_UNAVAILABLE");
}

const factoryAbi = parseAbi([
  "function virtualQuote0ForUsd(address quote, uint256 quoteUsd6) view returns (uint256)",
  "function instantCurveConfig() view returns (bytes32)",
]);
const registryAbi = parseAbi([
  "function isUsdPegOne(address) view returns (bool)",
  "function get(address) view returns (address token, string symbol, string name, uint8 decimals, string icon, uint8 category, bool enabled, bool exists, bool rewardsEnabled, bool buybackRouteEnabled, bool hopViaUsdc, bool reactorNative, bool usdPegOne)",
]);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)"]);

const chain = defineChain({
  id: deployment.chainId,
  name: "reactor",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? deployment.rpc] } },
});
const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });

async function sign(body: { quote?: string; creator?: string }) {
  const key = resolveKey();
  if (process.env.KEEPER_PRIVATE_KEY && process.env.KEEPER_PRIVATE_KEY === key) {
    throw new Error("pricing signer must not reuse keeper key");
  }
  const quote = body.quote as `0x${string}`;
  const creator = (body.creator ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
  if (!quote || !/^0x[0-9a-fA-F]{40}$/.test(quote)) throw new Error("quote required");

  const peg = await client.readContract({
    address: addrs.QuoteAssetRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: "isUsdPegOne",
    args: [quote],
  });
  if (peg) return { needsAuth: false, reason: "usdPegOne — unsigned Instant is allowed" };

  const quoteDecimals = Number(await client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }));
  const now = Math.floor(Date.now() / 1000);
  const staticZec = BigInt(process.env.ZEC_USD6 ?? 50_000_000);
  const fused = fuseExternalUsd6(
    quote.toLowerCase() === (addrs.ZEC ?? "").toLowerCase() ? [{ usd6: staticZec, ts: now, name: "local-static" }] : [],
    now,
  );
  const nodes = new Map<string, QuoteNode>([
    [(addrs.USDC ?? "").toLowerCase(), { token: addrs.USDC, symbol: "USDC", decimals: 6, usdPegOne: true }],
    [quote.toLowerCase(), { token: quote, symbol: "Q", decimals: quoteDecimals, usdPegOne: false, externalUsd6: fused.usd6, externalOk: fused.ok }],
  ]);
  const valued = valueQuoteUsd6(quote, nodes);
  if (!valued.ok || valued.usd6 === 0n) {
    throw new Error("cannot price quote — valuation unavailable, launch disabled");
  }

  const [virtualQuote0, curveConfig] = await Promise.all([
    client.readContract({ address: addrs.ReactorFactory as `0x${string}`, abi: factoryAbi, functionName: "virtualQuote0ForUsd", args: [quote, valued.usd6] }),
    client.readContract({ address: addrs.ReactorFactory as `0x${string}`, abi: factoryAbi, functionName: "instantCurveConfig" }),
  ]);

  const account = privateKeyToAccount(key);
  const deadline = BigInt(now + 5 * 60);
  const salt = (`0x${randomBytes(32).toString("hex")}`) as `0x${string}`;
  const signature = await account.signTypedData({
    domain: { name: "REACTOR", version: "1", chainId: deployment.chainId, verifyingContract: addrs.ReactorFactory as `0x${string}` },
    types: {
      LaunchPricingAuthorization: [
        { name: "factory", type: "address" },
        { name: "creator", type: "address" },
        { name: "quote", type: "address" },
        { name: "quoteDecimals", type: "uint8" },
        { name: "virtualQuote0", type: "uint256" },
        { name: "curveConfig", type: "bytes32" },
        { name: "salt", type: "bytes32" },
        { name: "deadline", type: "uint256" },
        { name: "chainId", type: "uint256" },
      ],
    },
    primaryType: "LaunchPricingAuthorization",
    message: {
      factory: addrs.ReactorFactory as `0x${string}`,
      creator,
      quote,
      quoteDecimals,
      virtualQuote0,
      curveConfig,
      salt,
      deadline,
      chainId: BigInt(deployment.chainId),
    },
  });

  return {
    needsAuth: true,
    auth: {
      factory: addrs.ReactorFactory,
      creator,
      quote,
      quoteDecimals,
      virtualQuote0: virtualQuote0.toString(),
      curveConfig,
      salt,
      deadline: deadline.toString(),
    },
    signature,
    signer: account.address,
    quoteUsd6: valued.usd6.toString(),
    ancestry: valued.ancestry,
    ttlSec: 300,
    trust: "Isolated pricing signer. Not an onchain USD oracle. Unique digest. usdPegOne-only $1 bypass.",
  };
}

const server = createServer(async (req, res) => {
  const rid = requestId({ headers: req.headers as Record<string, string | string[] | undefined> });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("x-request-id", rid);
  if (req.method === "GET" && req.url === "/health") {
    try {
      const acct = privateKeyToAccount(resolveKey());
      res.end(JSON.stringify({ ok: true, signer: acct.address, local: LOCAL, request_id: rid }));
    } catch (e) {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, error: String(e), request_id: rid }));
    }
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (!limit.allow(String(req.socket.remoteAddress))) {
    res.statusCode = 429;
    res.end(JSON.stringify({ error: "rate limited", request_id: rid }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { quote?: string; creator?: string };
    const out = await sign(body);
    res.end(JSON.stringify({ ...out, request_id: rid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sign failed";
    res.statusCode = msg.includes("UNAVAILABLE") || msg.includes("cannot price") ? 503 : 500;
    res.end(JSON.stringify({ error: msg, needsAuth: true, request_id: rid }));
  }
});

try {
  resolveKey();
} catch (e) {
  console.error("pricing signer refuse start", e);
  process.exit(1);
}

server.listen(PORT, "127.0.0.1", () => logLine({ msg: "pricing-signer", port: PORT, local: LOCAL }));
