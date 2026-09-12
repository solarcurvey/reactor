/**
 * Next BFF POST /api/launch-pricing against a real HTTP indexer-shaped
 * server that uses the same `gateProtectedWrite` as production.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindOperatorPolicyProviders,
  gateProtectedWrite,
  resetOperatorPolicyState,
  setFixtureBlockedWallets,
  setFixtureDatasetFreshness,
} from "../../../indexer/src/operator-policy.ts";
import { launchAuthorizeForwardHeaders, proxyLaunchAuthorize } from "./launch-authorize-proxy.ts";

const CLEAR = "0x1111111111111111111111111111111111111111";
const BLOCKED = "0x2222222222222222222222222222222222222222";
const CANARY = "CANARY_BFF_SIGNATURE";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    handler(req, res).catch((e) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

process.env.REACTOR_ENV = "LOCAL";
resetOperatorPolicyState();
setFixtureBlockedWallets([BLOCKED]);
setFixtureDatasetFreshness("current");

const downstream = { ran: 0 };
const indexer = await listen(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/markets" && req.method === "GET") {
    res.end(JSON.stringify({ items: [], public: true }));
    return;
  }
  if (url.pathname !== "/launch/authorize" || req.method !== "POST") {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
  const gate = await gateProtectedWrite({ headers: req.headers, body, surface: "launch.authorize" });
  if (!gate.ok) {
    res.statusCode = gate.status;
    res.end(JSON.stringify(gate.body));
    return;
  }
  downstream.ran += 1;
  res.end(JSON.stringify({ ok: true, signature: CANARY, auth: "LEAK" }));
});

try {
  const env = { ...process.env, INDEXER_URL: indexer.url, REACTOR_ENV: "LOCAL" };

  {
    const req = new Request("http://127.0.0.1/api/launch-pricing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sanctions-clear": "1",
        "cf-ipcountry": "US",
        "x-reactor-geo-fixture": "US",
      },
      body: JSON.stringify({
        wallet: BLOCKED,
        creator: BLOCKED,
        ticker: "CAT",
        sanctionsClear: true,
        country: "US",
      }),
    });
    const res = await proxyLaunchAuthorize(req, env);
    const json = (await res.json()) as Record<string, unknown>;
    assert(res.status === 403, `bff blocked wallet ${res.status}`);
    assert(json.reason === "DENY_ADDRESS_BLOCKED", `bff reason ${json.reason}`);
    assert(!JSON.stringify(json).includes(CANARY), "bff must not return signer payload");
    assert(downstream.ran === 0, "indexer signer path not reached");
  }

  {
    const req = new Request("http://127.0.0.1/api/launch-pricing", {
      method: "POST",
      headers: { "content-type": "application/json", "x-reactor-geo-fixture": "US" },
      body: JSON.stringify({ wallet: CLEAR, creator: CLEAR, ticker: "CAT" }),
    });
    const res = await proxyLaunchAuthorize(req, env);
    const json = (await res.json()) as Record<string, unknown>;
    assert(res.status === 200 && json.signature === CANARY, "bff allow reaches indexer");
    assert(downstream.ran === 1, "downstream once");
  }

  {
    const forwarded = launchAuthorizeForwardHeaders(
      new Request("http://x", {
        headers: { "x-sanctions-clear": "1", "cf-ipcountry": "IR", "x-reactor-geo-fixture": "US" },
      }),
      JSON.stringify({ wallet: CLEAR, sanctionsClear: true }),
    );
    assert(forwarded["x-reactor-wallet"] === CLEAR, "BFF adds wallet header from body");
    assert(forwarded["x-reactor-geo-fixture"] === "US", "trusted fixture forwarded");
    assert(!forwarded["x-sanctions-clear"], "clear flag not forwarded as authority");
    assert(!forwarded["cf-ipcountry"], "browser country not forwarded as authority");
  }

  {
    bindOperatorPolicyProviders({
      screenAddress: () => ({ decision: "clear", freshness: "current" }),
      evaluateGeo: () => ({ decision: "DENY", reason: "DENY_COMPREHENSIVE_JURISDICTION" }),
    });
    const before = downstream.ran;
    const req = new Request("http://127.0.0.1/api/launch-pricing", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sanctions-clear": "1", "cf-ipcountry": "US" },
      body: JSON.stringify({ wallet: CLEAR, sanctionsClear: true, country: "US" }),
    });
    const res = await proxyLaunchAuthorize(req, env);
    const json = (await res.json()) as Record<string, unknown>;
    assert(res.status === 403 && json.reason === "DENY_GEO_BLOCKED", "bff geo deny");
    assert(downstream.ran === before, "geo deny before payload");
    bindOperatorPolicyProviders(null);
  }

  {
    const markets = await fetch(`${indexer.url}/markets`);
    const json = (await markets.json()) as { public?: boolean };
    assert(markets.ok && json.public === true, "GET /markets still public through same host");
  }
} finally {
  await indexer.close();
  resetOperatorPolicyState();
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const route = readFileSync(join(here, "../app/api/launch-pricing/route.ts"), "utf8");
  assert(route.includes("proxyLaunchAuthorize"), "Next route uses shared proxy");
  assert(!route.includes("sanctionsClear"), "Next route does not honor client flags");
}

console.log("operator-policy Next BFF ok");
