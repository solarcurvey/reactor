import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORS_POLICY_HEADERS,
  bindOperatorPolicyProviders,
  extractSubjectWallet,
  fixtureEvaluateGeo,
  fixtureScreenAddress,
  gateProtectedWrite,
  isProtectedWritePath,
  isPublicReadPath,
  resetOperatorPolicyState,
  setFixtureBlockedWallets,
  setFixtureDatasetFreshness,
  setFixtureLocalDefaultGeo,
} from "./operator-policy.ts";
import { OPERATOR_POLICY_DISCLAIMER } from "../../../packages/reactor/src/sanctions-policy.ts";

const CLEAR = "0x1111111111111111111111111111111111111111";
const BLOCKED = "0x2222222222222222222222222222222222222222";
const CANARY_SIGNATURE = "CANARY_LAUNCH_SIGNATURE";
const CANARY_TX = "0xCANARY_TX_PAYLOAD";
const CANARY_UPLOAD = "/m/canary-should-not-leak.webp";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type Hit = { status: number; json: Record<string, unknown>; raw: string };

function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<{ url: URL; close: () => Promise<void> }> {
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
        url: new URL(`http://127.0.0.1:${port}/`),
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

function hit(
  url: URL,
  opts: { method?: string; path: string; body?: unknown; headers?: Record<string, string> },
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    const headers: Record<string, string> = { ...opts.headers };
    if (body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    const req = httpRequest(
      new URL(opts.path, url),
      { method: opts.method ?? "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(raw || "{}") as Record<string, unknown>;
          } catch {
            json = { parseError: raw };
          }
          resolve({ status: res.statusCode ?? 0, json, raw });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

/**
 * Production path names + the same `gateProtectedWrite` the indexer/signer call.
 * Downstream runs only after allow — canary payloads prove early denial.
 */
function createProductionShapedHandler(downstream: { ran: number }) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-headers", CORS_POLICY_HEADERS);

    if ((req.method ?? "GET") === "GET" && isPublicReadPath("GET", pathname)) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, path: pathname, items: [], public: true }));
      return;
    }

    if (req.method === "POST" && (isProtectedWritePath("POST", pathname) || pathname === "/")) {
      const surface =
        pathname === "/launch/authorize" || pathname === "/"
          ? "launch.authorize"
          : pathname === "/launch/admit"
            ? "launch.admit"
            : pathname === "/quote"
              ? "quote"
              : pathname === "/upload"
                ? "upload"
                : "signer";
      let body: Record<string, unknown> | undefined;
      if (pathname !== "/upload") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      }
      const gate = await gateProtectedWrite({ headers: req.headers, body, surface });
      if (!gate.ok) {
        res.statusCode = gate.status;
        res.end(JSON.stringify(gate.body));
        return;
      }
      downstream.ran += 1;
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: true,
          signature: CANARY_SIGNATURE,
          tx: { to: "0xfactory", data: CANARY_TX },
          uri: CANARY_UPLOAD,
          surface,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  };
}

function assertDenied(hitRes: Hit, reason: string, downstream: { ran: number }, before: number) {
  assert(hitRes.status === 403 || hitRes.status === 503, `${reason} status ${hitRes.status}`);
  assert(hitRes.json.reason === reason, `reason ${hitRes.json.reason} != ${reason}`);
  assert(hitRes.json.ok === false, "ok false");
  assert(typeof hitRes.json.error === "string" && String(hitRes.json.error).length > 0, "user error");
  assert(hitRes.json.disclaimer === OPERATOR_POLICY_DISCLAIMER, "disclaimer");
  assert(!hitRes.raw.includes(CANARY_SIGNATURE), "no signer payload");
  assert(!hitRes.raw.includes(CANARY_TX), "no tx payload");
  assert(!hitRes.raw.includes(CANARY_UPLOAD), "no upload payload");
  assert(downstream.ran === before, `downstream ran ${downstream.ran} after deny`);
}

function assertAllowed(hitRes: Hit, downstream: { ran: number }, before: number) {
  assert(hitRes.status === 200, `allow status ${hitRes.status} ${hitRes.raw}`);
  assert(hitRes.json.signature === CANARY_SIGNATURE, "allow returns payload");
  assert(downstream.ran === before + 1, "downstream ran once");
}

process.env.REACTOR_ENV = "LOCAL";
resetOperatorPolicyState();

{
  assert(isProtectedWritePath("POST", "/launch/authorize"), "authorize protected");
  assert(isProtectedWritePath("POST", "/launch/admit"), "admit protected");
  assert(isProtectedWritePath("POST", "/quote"), "quote protected");
  assert(isProtectedWritePath("POST", "/upload"), "upload protected");
  assert(!isProtectedWritePath("GET", "/markets"), "markets not a write");
  assert(isPublicReadPath("GET", "/markets"), "markets is public read");
  assert(isPublicReadPath("GET", "/health"), "health is public read");
  assert(isPublicReadPath("GET", "/ticker/CAT"), "ticker is public read");
  assert(isPublicReadPath("GET", "/candles/0x1111111111111111111111111111111111111111"), "candles read");
}

{
  const w = extractSubjectWallet({
    headers: { "x-sanctions-clear": "1", "cf-ipcountry": "US" },
    body: { sanctionsClear: true, country: "US", recipient: CLEAR },
  });
  assert(w === CLEAR, "wallet from recipient, not spoof flags");
  assert(
    extractSubjectWallet({
      headers: { "x-reactor-wallet": BLOCKED, "x-sanctions-clear": "true" },
      body: { sanctionsClear: true },
    }) === BLOCKED,
    "header wallet still screened",
  );
}

{
  setFixtureBlockedWallets([BLOCKED]);
  setFixtureDatasetFreshness("current");
  const blocked = fixtureScreenAddress(BLOCKED);
  const clear = fixtureScreenAddress(CLEAR);
  assert(blocked.decision === "blocked", "fixture blocked");
  assert(clear.decision === "clear", "fixture clear");
  const deny = fixtureEvaluateGeo({ "x-reactor-geo-fixture": "FX" });
  const allow = fixtureEvaluateGeo({ "x-reactor-geo-fixture": "US" });
  const spoofCountry = fixtureEvaluateGeo({ "cf-ipcountry": "US", "x-country": "US" });
  assert(deny.decision === "DENY", "FX denied");
  assert(allow.decision === "ALLOW", "US allowed");
  assert(spoofCountry.decision === "ALLOW", "LOCAL default allow — spoof country ignored");
  const prodGeo = fixtureEvaluateGeo({ "cf-ipcountry": "US" }, { REACTOR_ENV: "PROD" });
  assert(prodGeo.decision === "UNKNOWN", "PROD ignores browser country");
}

const downstream = { ran: 0 };
const srv = await listen(createProductionShapedHandler(downstream));

try {
  resetOperatorPolicyState();
  setFixtureBlockedWallets([BLOCKED]);
  setFixtureDatasetFreshness("current");
  setFixtureLocalDefaultGeo("ALLOW");

  {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/launch/authorize",
      body: { wallet: BLOCKED, creator: BLOCKED, ticker: "CAT" },
      headers: { "x-reactor-geo-fixture": "US" },
    });
    assertDenied(r, "DENY_ADDRESS_BLOCKED", downstream, before);
  }

  {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/quote",
      body: { recipient: CLEAR, kind: "BUY", tokenIn: CLEAR, tokenOut: BLOCKED, amountIn: "1" },
      headers: { "x-reactor-geo-fixture": "FX" },
    });
    assertDenied(r, "DENY_GEO_BLOCKED", downstream, before);
  }

  {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/launch/admit",
      body: { wallet: CLEAR, ticker: "CAT" },
      headers: { "x-reactor-geo-fixture": "US" },
    });
    assertAllowed(r, downstream, before);
  }

  {
    setFixtureDatasetFreshness("stale");
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/launch/authorize",
      body: { wallet: CLEAR },
      headers: { "x-reactor-geo-fixture": "US" },
    });
    assertDenied(r, "UNAVAILABLE_DATASET_STALE", downstream, before);
    setFixtureDatasetFreshness("current");
  }

  {
    setFixtureDatasetFreshness("missing");
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/upload",
      headers: { "x-reactor-wallet": CLEAR, "x-reactor-geo-fixture": "US" },
    });
    assertDenied(r, "UNAVAILABLE_DATASET_MISSING", downstream, before);
    setFixtureDatasetFreshness("current");
  }

  {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/launch/authorize",
      body: {
        wallet: BLOCKED,
        creator: BLOCKED,
        sanctionsClear: true,
        ofacClear: true,
        country: "US",
        complianceOk: true,
      },
      headers: {
        "x-sanctions-clear": "1",
        "x-ofac-clear": "true",
        "x-compliance-ok": "1",
        "cf-ipcountry": "US",
        "x-country": "US",
        "x-forwarded-for": "8.8.8.8",
        "x-reactor-geo-fixture": "US",
      },
    });
    assertDenied(r, "DENY_ADDRESS_BLOCKED", downstream, before);
  }

  {
    const markets = await hit(srv.url, { path: "/markets" });
    assert(markets.status === 200 && markets.json.public === true, "GET /markets not blocked");
    const health = await hit(srv.url, { path: "/health" });
    assert(health.status === 200 && health.json.ok === true, "GET /health not blocked");
    const ticker = await hit(srv.url, { path: "/ticker/CAT" });
    assert(ticker.status === 200, "GET /ticker not blocked");
  }

  {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/",
      body: { creator: BLOCKED, wallet: BLOCKED },
      headers: { "x-reactor-geo-fixture": "US" },
    });
    assertDenied(r, "DENY_ADDRESS_BLOCKED", downstream, before);
  }

  {
    bindOperatorPolicyProviders({
      screenAddress: () => ({ decision: "unavailable", reason: "missing_dataset", freshness: "missing" }),
      evaluateGeo: () => ({ decision: "ALLOW", reason: "ALLOW_JURISDICTION_NOT_LISTED" }),
    });
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/quote",
      body: { recipient: CLEAR, sanctionsClear: true },
      headers: { "x-sanctions-clear": "1", "cf-ipcountry": "US" },
    });
    assertDenied(r, "UNAVAILABLE_DATASET_MISSING", downstream, before);
    bindOperatorPolicyProviders(null);
  }

  {
    const prod = await gateProtectedWrite({
      headers: { "cf-ipcountry": "US", "x-sanctions-clear": "1" },
      body: { wallet: CLEAR, sanctionsClear: true, country: "US" },
      env: { REACTOR_ENV: "PROD" },
      surface: "launch.authorize",
    });
    assert(!prod.ok, "PROD without official plugins fail-closes");
    assert(prod.status === 503, "PROD unavailable is 503");
  }
} finally {
  await srv.close();
  resetOperatorPolicyState();
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
  const signerSrc = readFileSync(join(here, "pricing-signer.ts"), "utf8");
  for (const path of ["/launch/admit", "/launch/authorize", "/quote", "/upload"]) {
    const idx = indexSrc.indexOf(`url.pathname === "${path}"`);
    assert(idx >= 0, `index.ts has ${path}`);
    const after = indexSrc.slice(idx, idx + 2200);
    assert(after.includes("gateProtectedWrite"), `${path} calls gateProtectedWrite`);
    if (path === "/launch/authorize") {
      assert(after.indexOf("gateProtectedWrite") < after.indexOf("authorizeLaunch"), "authorize gated before sign");
    }
    if (path === "/quote") {
      assert(after.indexOf("gateProtectedWrite") < after.indexOf("buildQuote"), "quote gated before ticket");
    }
    if (path === "/upload") {
      assert(after.indexOf("gateProtectedWrite") < after.indexOf("media.put"), "upload gated before store");
    }
  }
  assert(signerSrc.includes("gateProtectedWrite"), "isolated signer gated");
  assert(signerSrc.indexOf("gateProtectedWrite") < signerSrc.indexOf("signAuthorized"), "signer gated before output");
}

console.log("operator-policy http matrix ok");
