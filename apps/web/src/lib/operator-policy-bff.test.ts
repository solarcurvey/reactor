/**
 * Next BFF POST /api/launch-pricing against a real HTTP indexer-shaped
 * server that uses the same `gateProtectedWrite` as production.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  gateProtectedWrite,
  issueOperatorWalletChallenge,
  resetOperatorPolicyState,
  setFixtureBlockedWallets,
  setFixtureDatasetFreshness,
} from "../../../indexer/src/operator-policy.ts";
import { launchAuthorizeForwardHeaders, proxyLaunchAuthorize } from "./launch-authorize-proxy.ts";

const CLAIMED_CLEAR = "0x1111111111111111111111111111111111111111";
const blockedAcct = privateKeyToAccount(generatePrivateKey());
const clearAcct = privateKeyToAccount(generatePrivateKey());
const BLOCKED = blockedAcct.address.toLowerCase();
const CLEAR = clearAcct.address.toLowerCase();
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

async function proofHeader(account: { signMessage: (a: { message: string }) => Promise<string> }): Promise<string> {
  const issued = issueOperatorWalletChallenge();
  if ("error" in issued) throw new Error(issued.error);
  const signature = await account.signMessage({ message: issued.message });
  return JSON.stringify({ token: issued.token, signature });
}

async function main() {
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
    res.end(JSON.stringify({ ok: true, signature: CANARY, auth: "LEAK", wallet: gate.wallet }));
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
          "x-reactor-wallet": CLAIMED_CLEAR,
          "x-reactor-wallet-proof": await proofHeader(blockedAcct),
          "x-reactor-geo-fixture": "US",
        },
        body: JSON.stringify({
          wallet: CLAIMED_CLEAR,
          creator: CLAIMED_CLEAR,
          recipient: CLAIMED_CLEAR,
          ticker: "CAT",
          sanctionsClear: true,
          country: "US",
        }),
      });
      const res = await proxyLaunchAuthorize(req, env);
      const json = (await res.json()) as Record<string, unknown>;
      assert(res.status === 403, `bff blocked signer ${res.status} ${JSON.stringify(json)}`);
      assert(json.reason === "DENY_ADDRESS_BLOCKED", `bff reason ${json.reason}`);
      assert(!JSON.stringify(json).includes(CANARY), "bff must not return signer payload");
      assert(downstream.ran === 0, "indexer signer path not reached");
    }

    {
      const req = new Request("http://127.0.0.1/api/launch-pricing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reactor-wallet-proof": await proofHeader(clearAcct),
          "x-reactor-geo-fixture": "US",
        },
        body: JSON.stringify({ wallet: CLAIMED_CLEAR, creator: CLAIMED_CLEAR, ticker: "CAT" }),
      });
      const res = await proxyLaunchAuthorize(req, env);
      const json = (await res.json()) as Record<string, unknown>;
      assert(res.status === 200 && json.signature === CANARY, "bff allow reaches indexer");
      assert(json.wallet === CLEAR, "recovered clear signer, not claimed");
      assert(downstream.ran === 1, "downstream once");
    }

    {
      const forwarded = launchAuthorizeForwardHeaders(
        new Request("http://x", {
          headers: {
            "x-sanctions-clear": "1",
            "cf-ipcountry": "IR",
            "x-reactor-wallet": CLAIMED_CLEAR,
            "x-reactor-wallet-proof": "{\"token\":\"t\",\"signature\":\"s\"}",
            "x-reactor-geo-fixture": "US",
          },
        }),
        JSON.stringify({ wallet: CLAIMED_CLEAR, sanctionsClear: true }),
      );
      assert(forwarded["x-reactor-wallet-proof"]?.includes("token"), "proof forwarded");
      assert(!forwarded["x-reactor-wallet"], "claimed wallet header stripped");
      assert(!forwarded["x-reactor-geo-fixture"], "browser geo fixture is not replayed through Next");
      assert(!forwarded["x-sanctions-clear"], "clear flag not forwarded as authority");
      assert(!forwarded["cf-ipcountry"], "browser country not forwarded as authority");
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
    const routeCandidates = [
      join(process.cwd(), "src/app/api/launch-pricing/route.ts"),
      join(process.cwd(), "apps/web/src/app/api/launch-pricing/route.ts"),
    ];
    const routePath = routeCandidates.find((p) => existsSync(p));
    assert(routePath, "launch-pricing route exists");
    const route = readFileSync(routePath, "utf8");
    assert(route.includes("proxyLaunchAuthorize"), "Next route uses shared proxy");
    assert(!route.includes("sanctionsClear"), "Next route does not honor client flags");
  }

  console.log("operator-policy Next BFF ok");
}

void main();
