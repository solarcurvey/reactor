import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import {
  IGNORED_CLIENT_AUTHORITY,
  OPERATOR_POLICY_CHALLENGE_PATH,
  OPERATOR_POLICY_STATUS_PATH,
  fetchIndexerPolicyStatus,
  pickForwardHeaders,
  productionLike,
  resolveOperatorPolicyStatus,
} from "./operator-policy-status.ts";
import { PUBLIC_POLICY_VIEW_KEYS } from "./operator-policy";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
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

async function main() {
{
  assert(!productionLike({ REACTOR_ENV: "LOCAL" }), "LOCAL");
  assert(productionLike({ REACTOR_ENV: "PROD" }), "PROD");
  assert(productionLike({ NODE_ENV: "production" }), "NODE_ENV production");
  assert(!productionLike({ NODE_ENV: "production", REACTOR_ENV: "LOCAL" }), "LOCAL wins");
}

{
  const incoming = new Headers({
    "x-reactor-wallet-proof": '{"token":"t","signature":"0x1"}',
    "x-request-id": "req-1",
    "x-sanctions-clear": "1",
    "x-reactor-wallet": "0x1111111111111111111111111111111111111111",
    "cf-ipcountry": "FX",
    "x-forwarded-for": "203.0.113.9",
    "x-real-ip": "203.0.113.9",
  });
  const forwarded = pickForwardHeaders(incoming);
  assert(forwarded.get("x-reactor-wallet-proof")?.includes("token"), "proof forwarded");
  assert(forwarded.get("x-request-id") === "req-1", "request id forwarded");
  for (const name of IGNORED_CLIENT_AUTHORITY) {
    assert(!forwarded.has(name), `${name} must not be forwarded`);
  }
}

{
  const incoming = new Headers({ "x-reactor-geo-fixture": "country=FX" });
  const local = pickForwardHeaders(incoming, { REACTOR_ENV: "LOCAL" });
  assert(local.get("x-reactor-geo-fixture") === "country=FX", "LOCAL may forward geo fixture");
  const prod = pickForwardHeaders(incoming, { REACTOR_ENV: "PROD" });
  assert(!prod.has("x-reactor-geo-fixture"), "PROD must not forward geo fixture");
}

{
  const req = new Request("http://127.0.0.1/api/operator-policy?fixture=DENY_GEO_BLOCKED&sanctionsClear=1", {
    headers: {
      "x-sanctions-clear": "1",
      "cf-ipcountry": "US",
      "x-reactor-wallet": "0x1111111111111111111111111111111111111111",
    },
  });
  const view = await resolveOperatorPolicyStatus({
    req,
    env: { REACTOR_ENV: "LOCAL" },
    fetchImpl: async () => {
      throw new Error("indexer should not be required for LOCAL fixture");
    },
  });
  assert(view.kind === "geo", "LOCAL fixture geo");
  assert(view.source === "fixture", "fixture source");
  assert(!view.writesAllowed, "fixture disables writes");
  assert(!JSON.stringify(view).includes("203.0.113"), "no IP");
}

{
  const req = new Request("http://127.0.0.1/api/operator-policy?fixture=DENY_GEO_BLOCKED", {
    headers: { "x-reactor-ux-fixture": "DENY_GEO_BLOCKED" },
  });
  const view = await resolveOperatorPolicyStatus({
    req,
    env: { REACTOR_ENV: "PROD", NODE_ENV: "production" },
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert(view.kind === "unavailable", "PROD ignores LOCAL fixture query");
  assert(view.source === "stub", "PROD stub");
  assert(!view.writesAllowed, "PROD fail-closed without #62");
}

{
  const req = new Request("http://127.0.0.1/api/operator-policy");
  const local = await resolveOperatorPolicyStatus({
    req,
    env: { REACTOR_ENV: "LOCAL" },
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert(local.writesAllowed && local.source === "stub", "LOCAL stub allow when #62 missing");
}

{
  const indexer = await listen((req, res) => {
    assert(!req.headers["x-sanctions-clear"], "indexer must not see clear flag");
    assert(!req.headers["cf-ipcountry"], "indexer must not see browser country");
    assert(!req.headers["x-forwarded-for"], "indexer must not see forwarded IP from BFF");
    assert(!req.headers["x-reactor-wallet"], "claimed wallet never forwarded");
    if (req.url === OPERATOR_POLICY_STATUS_PATH || req.url?.startsWith(`${OPERATOR_POLICY_STATUS_PATH}?`)) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          reason: "DENY_ADDRESS_BLOCKED",
          decision: "deny",
          error: "REACTOR-operated services are not available for this account.",
          ip: "2001:db8::1",
          country: "IR",
          addressScreen: { sdn: "ACME", uid: "999" },
          wallet: "0x2222222222222222222222222222222222222222",
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  try {
    const incoming = new Headers({
      "x-reactor-wallet-proof": "proof",
      "x-reactor-wallet": "0xCLAIMED",
      "x-sanctions-clear": "1",
      "cf-ipcountry": "IR",
      "x-forwarded-for": "2001:db8::1",
    });
    const view = await fetchIndexerPolicyStatus({
      indexer: indexer.url,
      headers: pickForwardHeaders(incoming),
    });
    assert("ok" in view && view.kind === "wallet", "coordinated status GET is the decision");
    if ("ok" in view) {
      const json = JSON.stringify(view);
      assert(!json.includes("2001:db8"), "IPv6 stripped");
      assert(!json.includes("ACME"), "SDN stripped");
      assert(!json.includes("IR"), "country stripped");
      assert(!json.includes("0x2222"), "wallet stripped");
      assert(Object.keys(view).every((k) => (PUBLIC_POLICY_VIEW_KEYS as readonly string[]).includes(k)), "public keys");
    }
  } finally {
    await indexer.close();
  }
}

{
  const indexer = await listen((req, res) => {
    if (req.url === OPERATOR_POLICY_CHALLENGE_PATH || req.url?.startsWith(`${OPERATOR_POLICY_CHALLENGE_PATH}?`)) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ token: "t", message: "REACTOR operator-policy v1\n..." }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  try {
    const view = await fetchIndexerPolicyStatus({
      indexer: indexer.url,
      headers: new Headers(),
    });
    assert("present" in view, "stock #68 challenge-only is present, not a fake decision");
  } finally {
    await indexer.close();
  }
}

{
  const req = new Request("http://127.0.0.1/api/operator-policy");
  const prod = await resolveOperatorPolicyStatus({
    req,
    env: { REACTOR_ENV: "PROD", NODE_ENV: "production" },
    fetchImpl: async (url) => {
      const path = String(url);
      if (path.endsWith(OPERATOR_POLICY_STATUS_PATH)) return new Response(null, { status: 404 });
      if (path.endsWith(OPERATOR_POLICY_CHALLENGE_PATH)) {
        return new Response(JSON.stringify({ token: "t", message: "REACTOR operator-policy v1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${path}`);
    },
  });
  assert(prod.kind === "unavailable", "PROD fail-closes on stock #68 challenge-only");
  assert(!prod.writesAllowed, "PROD writes disabled without a decision GET");
}

{
  const req = new Request("http://127.0.0.1/api/operator-policy");
  const prod = await resolveOperatorPolicyStatus({
    req,
    env: { REACTOR_ENV: "PROD", NODE_ENV: "production" },
    fetchImpl: async (url) => {
      assert(String(url).endsWith(OPERATOR_POLICY_STATUS_PATH), `PROD prefers status, got ${url}`);
      return new Response(
        JSON.stringify({
          ok: true,
          reason: "ALLOW",
          decision: "allow",
          kind: "allow",
          error: "",
          writesAllowed: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  assert(prod.kind === "allow" && prod.writesAllowed, "PROD uses coordinated status decision");
}

{
  const req = new Request("http://127.0.0.1/api/operator-policy", {
    headers: { "x-reactor-ux-fixture": "DENY_ADDRESS_BLOCKED" },
  });
  const view = await resolveOperatorPolicyStatus({
    req,
    env: { REACTOR_ENV: "LOCAL" },
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert(view.kind === "wallet", "header fixture wallet");
}

console.log("operator-policy-status ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
