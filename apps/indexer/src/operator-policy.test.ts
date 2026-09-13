import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  CORS_POLICY_HEADERS,
  bindOperatorPolicyProviders,
  claimedClientWallet,
  extractSubjectWallet,
  fixtureEvaluateGeo,
  fixtureScreenAddress,
  gateProtectedWrite,
  issueOperatorWalletChallenge,
  isProtectedWritePath,
  isPublicReadPath,
  officialPolicyPluginsBound,
  readOperatorPolicyStatus,
  screenWithSharedOfficialStore,
  resetOperatorPolicyState,
  setFixtureBlockedWallets,
  setFixtureDatasetFreshness,
  setFixtureLocalDefaultGeo,
  tryBindOfficialPolicyPlugins,
  walletProofSecret,
} from "./operator-policy.ts";
import { signGeoClaim } from "./geo-edge.ts";
import { OPERATOR_POLICY_DISCLAIMER } from "../../../packages/reactor/src/sanctions-policy.ts";

const CLAIMED_CLEAR = "0x1111111111111111111111111111111111111111";
const CANARY_SIGNATURE = "CANARY_LAUNCH_SIGNATURE";
const CANARY_TX = "0xCANARY_TX_PAYLOAD";
const CANARY_UPLOAD = "/m/canary-should-not-leak.webp";

const blockedAcct = privateKeyToAccount(generatePrivateKey());
const clearAcct = privateKeyToAccount(generatePrivateKey());
const BLOCKED = blockedAcct.address.toLowerCase();
const CLEAR = clearAcct.address.toLowerCase();

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

async function signProof(account: { signMessage: (a: { message: string }) => Promise<string> }): Promise<string> {
  const issued = issueOperatorWalletChallenge();
  if ("error" in issued) throw new Error(issued.error);
  const signature = await account.signMessage({ message: issued.message });
  return JSON.stringify({ token: issued.token, signature });
}

const GEO_EDGE_SECRET = "geo-edge-secret-ok!!";

function signedOfficialGeoHeaders(parts: {
  country: string;
  region?: string;
  regionName?: string;
  nowMs?: number;
}): Record<string, string> {
  const ts = String(Math.floor((parts.nowMs ?? Date.now()) / 1000));
  const country = parts.country;
  const region = parts.region ?? "";
  const regionName = parts.regionName ?? "";
  const anonymizer = "none";
  const ip = "203.0.113.10";
  const mac = signGeoClaim(GEO_EDGE_SECRET, { ts, country, region, regionName, anonymizer, ip });
  const headers: Record<string, string> = {
    "x-reactor-geo-ts": ts,
    "x-reactor-geo-country": country,
    "x-reactor-geo-region": region,
    "x-reactor-geo-anonymizer": anonymizer,
    "x-reactor-geo-ip": ip,
    "x-reactor-geo-mac": mac,
  };
  if (regionName) headers["x-reactor-geo-region-name"] = regionName;
  return headers;
}

async function spoofHeaders(signer: typeof blockedAcct, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return {
    "x-reactor-wallet-proof": await signProof(signer),
    "x-reactor-wallet": CLAIMED_CLEAR,
    "x-sanctions-clear": "1",
    "x-ofac-clear": "true",
    "cf-ipcountry": "US",
    "x-country": "US",
    "x-forwarded-for": "8.8.8.8",
    "x-reactor-geo-fixture": extra["x-reactor-geo-fixture"] ?? "US",
    ...extra,
  };
}

function spoofBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    wallet: CLAIMED_CLEAR,
    creator: CLAIMED_CLEAR,
    recipient: CLAIMED_CLEAR,
    account: CLAIMED_CLEAR,
    sanctionsClear: true,
    ofacClear: true,
    country: "US",
    complianceOk: true,
    ...extra,
  };
}

function createProductionShapedHandler(downstream: { ran: number; lastWallet?: string }) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-headers", CORS_POLICY_HEADERS);

    if ((req.method ?? "GET") === "GET" && isPublicReadPath("GET", pathname)) {
      if (pathname === "/operator-policy/challenge") {
        const issued = issueOperatorWalletChallenge();
        res.statusCode = "error" in issued ? 503 : 200;
        res.end(JSON.stringify(issued));
        return;
      }
      if (pathname === "/operator-policy/status") {
        const out = await readOperatorPolicyStatus({ headers: req.headers });
        res.statusCode = out.status;
        res.end(JSON.stringify({ ...out.body, public: true }));
        return;
      }
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
      downstream.lastWallet = gate.wallet;
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: true,
          signature: CANARY_SIGNATURE,
          tx: { to: "0xfactory", data: CANARY_TX, recipient: gate.wallet },
          uri: CANARY_UPLOAD,
          surface,
          wallet: gate.wallet,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  };
}

function assertDenied(hitRes: Hit, reason: string, downstream: { ran: number }, before: number) {
  assert(hitRes.status === 403 || hitRes.status === 503, `${reason} status ${hitRes.status} ${hitRes.raw}`);
  assert(hitRes.json.reason === reason, `reason ${hitRes.json.reason} != ${reason} ${hitRes.raw}`);
  assert(hitRes.json.ok === false, "ok false");
  assert(typeof hitRes.json.error === "string" && String(hitRes.json.error).length > 0, "user error");
  assert(hitRes.json.disclaimer === OPERATOR_POLICY_DISCLAIMER, "disclaimer");
  assert(!hitRes.raw.includes(CANARY_SIGNATURE), "no signer payload");
  assert(!hitRes.raw.includes(CANARY_TX), "no tx payload");
  assert(!hitRes.raw.includes(CANARY_UPLOAD), "no upload payload");
  assert(downstream.ran === before, `downstream ran ${downstream.ran} after deny`);
}

function assertAllowed(hitRes: Hit, downstream: { ran: number }, before: number, wallet: string) {
  assert(hitRes.status === 200, `allow status ${hitRes.status} ${hitRes.raw}`);
  assert(hitRes.json.signature === CANARY_SIGNATURE, "allow returns payload");
  assert(hitRes.json.wallet === wallet, `bound wallet ${hitRes.json.wallet}`);
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
  assert(isPublicReadPath("GET", "/operator-policy/challenge"), "challenge is public");
  assert(isPublicReadPath("GET", "/operator-policy/status"), "status is public");
  assert(isPublicReadPath("GET", "/sanctions/screen"), "#66 screen lookup is public");
  assert(isPublicReadPath("GET", "/sanctions/dataset"), "#66 dataset lookup is public");
  assert(!isProtectedWritePath("GET", "/sanctions/screen"), "screen lookup is not a write");
}

{
  assert(extractSubjectWallet({ headers: {}, body: { wallet: CLAIMED_CLEAR } }) === undefined, "claimed wallet is not subject");
  assert(claimedClientWallet({ headers: { "x-reactor-wallet": CLAIMED_CLEAR }, body: {} }) === CLAIMED_CLEAR, "claimed still parsed for ignore list");
  const cors = CORS_POLICY_HEADERS.split(",");
  assert(cors.includes("x-reactor-wallet-proof"), "proof header is CORS-permitted");
  assert(!cors.includes("x-reactor-wallet"), "claimed wallet header is not CORS-permitted");
}

{
  setFixtureBlockedWallets([BLOCKED]);
  setFixtureDatasetFreshness("current");
  assert(fixtureScreenAddress(BLOCKED).decision === "blocked", "fixture blocked");
  assert(fixtureScreenAddress(CLEAR).decision === "clear", "fixture clear");
  assert(fixtureEvaluateGeo({ "x-reactor-geo-fixture": "FX" }).decision === "DENY", "FX denied");
  assert(fixtureEvaluateGeo({ "cf-ipcountry": "US" }, { REACTOR_ENV: "PROD" }).decision === "UNKNOWN", "PROD ignores browser country");
}

const downstream = { ran: 0, lastWallet: "" };
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
      body: spoofBody({ ticker: "CAT" }),
      headers: await spoofHeaders(blockedAcct),
    });
    assertDenied(r, "DENY_ADDRESS_BLOCKED", downstream, before);
  }

  {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/quote",
      body: spoofBody({ kind: "BUY", amountIn: "1" }),
      headers: await spoofHeaders(clearAcct, { "x-reactor-geo-fixture": "FX" }),
    });
    assertDenied(r, "DENY_GEO_BLOCKED", downstream, before);
  }

  {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/launch/admit",
      body: spoofBody({ ticker: "CAT" }),
      headers: await spoofHeaders(clearAcct),
    });
    assertAllowed(r, downstream, before, CLEAR);
  }

  {
    setFixtureDatasetFreshness("stale");
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/launch/authorize",
      body: spoofBody(),
      headers: await spoofHeaders(clearAcct),
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
      headers: await spoofHeaders(clearAcct),
    });
    assertDenied(r, "UNAVAILABLE_DATASET_MISSING", downstream, before);
    setFixtureDatasetFreshness("current");
  }

  {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/launch/authorize",
      body: spoofBody({ ticker: "CAT" }),
      headers: {
        "x-reactor-wallet": CLAIMED_CLEAR,
        "x-sanctions-clear": "1",
        "cf-ipcountry": "US",
        "x-reactor-geo-fixture": "US",
      },
    });
    assertDenied(r, "UNAVAILABLE_WALLET_MISSING", downstream, before);
  }

  const spoofSurfaces = ["/launch/admit", "/launch/authorize", "/quote", "/upload", "/"] as const;
  for (const path of spoofSurfaces) {
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path,
      body: path === "/upload" ? undefined : spoofBody(),
      headers: await spoofHeaders(blockedAcct),
    });
    assertDenied(r, "DENY_ADDRESS_BLOCKED", downstream, before);
  }

  {
    const markets = await hit(srv.url, { path: "/markets" });
    assert(markets.status === 200 && markets.json.public === true, "GET /markets not blocked");
    const challenge = await hit(srv.url, { path: "/operator-policy/challenge" });
    assert(challenge.status === 200 && typeof challenge.json.message === "string", "challenge issues");
  }

  {
    const geo = await hit(srv.url, {
      path: "/operator-policy/status",
      headers: { "x-reactor-geo-fixture": "FX", "x-reactor-wallet": CLAIMED_CLEAR, "x-sanctions-clear": "1" },
    });
    assert(geo.json.reason === "DENY_GEO_BLOCKED", `status geo ${geo.raw}`);
    assert(geo.json.kind === "geo" && geo.json.writesAllowed === false, "status geo kind");
    assert(!geo.raw.includes(CLAIMED_CLEAR), "status omits claimed wallet");
    assert(!geo.raw.includes("addressScreen"), "status omits screen internals");

    const pending = await hit(srv.url, {
      path: "/operator-policy/status",
      headers: { "x-reactor-geo-fixture": "US", "x-reactor-wallet": CLAIMED_CLEAR },
    });
    assert(pending.json.reason === "UNAVAILABLE_WALLET_MISSING", `status needs proof ${pending.raw}`);
    assert(pending.json.kind === "unavailable" && pending.json.writesAllowed === false, "missing proof not allow");

    const blockedStatus = await hit(srv.url, {
      path: "/operator-policy/status",
      headers: await spoofHeaders(blockedAcct),
    });
    assert(blockedStatus.json.reason === "DENY_ADDRESS_BLOCKED", `status blocked ${blockedStatus.raw}`);
    assert(blockedStatus.json.kind === "wallet", "status wallet kind");
    assert(!blockedStatus.raw.includes(BLOCKED) && !blockedStatus.raw.includes(CLAIMED_CLEAR), "status omits addresses");

    const allowStatus = await hit(srv.url, {
      path: "/operator-policy/status",
      headers: await spoofHeaders(clearAcct),
    });
    assert(allowStatus.status === 200 && allowStatus.json.reason === "ALLOW", `status allow ${allowStatus.raw}`);
    assert(allowStatus.json.ok === true && allowStatus.json.writesAllowed === true, "status allow flags");
    assert(allowStatus.json.kind === "allow" && allowStatus.json.source === "indexer", "status allow kind");
  }

  {
    resetOperatorPolicyState();
    process.env.OPERATOR_POLICY_PLUGIN_BLOCKED = BLOCKED;
    const bound = await tryBindOfficialPolicyPlugins(process.env, join(dirname(fileURLToPath(import.meta.url)), "operator-policy-plugin-fixtures"));
    assert(bound.address && bound.geo, `official plugin path ${JSON.stringify(bound)}`);
    const before = downstream.ran;
    const r = await hit(srv.url, {
      method: "POST",
      path: "/quote",
      body: spoofBody(),
      headers: await spoofHeaders(blockedAcct),
    });
    assertDenied(r, "DENY_ADDRESS_BLOCKED", downstream, before);
    const allow = await hit(srv.url, {
      method: "POST",
      path: "/quote",
      body: spoofBody(),
      headers: await spoofHeaders(clearAcct),
    });
    assertAllowed(allow, downstream, before + 0, CLEAR);
    bindOperatorPolicyProviders(null);
    resetOperatorPolicyState();
    setFixtureBlockedWallets([BLOCKED]);
    delete process.env.OPERATOR_POLICY_PLUGIN_BLOCKED;
  }

  {
    resetOperatorPolicyState();
    const here = dirname(fileURLToPath(import.meta.url));
    const prevDataDir = process.env.SANCTIONS_DATA_DIR;
    const emptyDir = mkdtempSync(join(tmpdir(), "op-ofac-empty-"));
    process.env.SANCTIONS_DATA_DIR = emptyDir;
    try {
      const localEmpty = await tryBindOfficialPolicyPlugins({ ...process.env, REACTOR_ENV: "LOCAL" }, here);
      assert(localEmpty.address === false, `LOCAL without current #66 dataset keeps fixtures ${JSON.stringify(localEmpty)}`);
      assert(localEmpty.geo === true, `official #67 geo binds without a dataset ${JSON.stringify(localEmpty)}`);
      assert(officialPolicyPluginsBound() === false, "both official plugins required for officialBound");
      resetOperatorPolicyState();
      const prodEmpty = await tryBindOfficialPolicyPlugins({ ...process.env, REACTOR_ENV: "PROD" }, here);
      assert(prodEmpty.address === true, `PROD binds official #66 sanctions.ts even if unavailable ${JSON.stringify(prodEmpty)}`);
      assert(prodEmpty.geo === true, `official #67 geo-policy-resolve.ts binds ${JSON.stringify(prodEmpty)}`);
      assert(officialPolicyPluginsBound() === true, "PROD officialBound needs both plugins");
    } finally {
      if (prevDataDir === undefined) delete process.env.SANCTIONS_DATA_DIR;
      else process.env.SANCTIONS_DATA_DIR = prevDataDir;
      rmSync(emptyDir, { recursive: true, force: true });
      resetOperatorPolicyState();
    }
  }

  {
    const emptyStore = {
      screen: () => ({ decision: "unavailable" as const, reason: "missing_dataset", freshness: "missing" as const }),
    };
    const sharedBlocked = screenWithSharedOfficialStore(emptyStore, BLOCKED, {
      REACTOR_ENV: "LOCAL",
      OPERATOR_POLICY_BLOCKED_WALLETS: BLOCKED,
      OPERATOR_POLICY_DATASET_FRESHNESS: "current",
    });
    assert(sharedBlocked.decision === "blocked", "LOCAL empty shared store keeps env blocked wallets");
    const sharedStale = screenWithSharedOfficialStore(emptyStore, CLEAR, {
      REACTOR_ENV: "LOCAL",
      OPERATOR_POLICY_DATASET_FRESHNESS: "stale",
    });
    assert(sharedStale.decision === "unavailable" && sharedStale.freshness === "stale", "stale env override survives shared store");
  }

  {
    resetOperatorPolicyState();
    const here = dirname(fileURLToPath(import.meta.url));
    const prevDataDir = process.env.SANCTIONS_DATA_DIR;
    const dataDir = mkdtempSync(join(tmpdir(), "op-ofac-"));
    process.env.SANCTIONS_DATA_DIR = dataDir;
    try {
      const { indexerSanctionsStore } = await import("./sanctions.ts");
      const { refreshSanctions } = await import("../../../packages/sanctions/src/refresh.ts");
      const { FIXTURE_ADDRESSES, pinnedFixtureBodies } = await import("../../../packages/sanctions/src/fixtures.ts");
      const store = indexerSanctionsStore();
      const loaded = await refreshSanctions(store, {
        sourceIds: ["ofac-sdn-xml"],
        bodies: pinnedFixtureBodies(),
        now: () => Date.parse("2026-09-12T00:00:00.000Z"),
        validation: { minAddresses: 1, rejectIfFewerThanPriorRatio: 0 },
      });
      assert(loaded.ok, `official fixture dataset ${JSON.stringify(loaded)}`);
      assert(store.screen(FIXTURE_ADDRESSES.sanctionedEvm).decision === "blocked", "official #66 screen blocked");
      assert(store.screen(FIXTURE_ADDRESSES.clearEvm).decision === "clear", "official #66 screen clear");

      const bound = await tryBindOfficialPolicyPlugins(process.env, here);
      assert(bound.address === true, `official #66 sanctions.ts binds ${JSON.stringify(bound)}`);
      assert(bound.geo === true, `official #67 evaluateRequestGeo binds ${JSON.stringify(bound)}`);
      assert(officialPolicyPluginsBound() === true, "official #66+#67 path sets officialBound");
      const before = downstream.ran;
      const allow = await hit(srv.url, {
        method: "POST",
        path: "/quote",
        body: spoofBody(),
        headers: await spoofHeaders(clearAcct),
      });
      assertAllowed(allow, downstream, before, CLEAR);

      const officialFx = await hit(srv.url, {
        method: "POST",
        path: "/quote",
        body: spoofBody(),
        headers: await spoofHeaders(clearAcct, { "x-reactor-geo-fixture": "FX" }),
      });
      assertDenied(officialFx, "DENY_GEO_BLOCKED", downstream, before + 1);

      const prodGeoEnv = {
        ...process.env,
        REACTOR_ENV: "PROD",
        GEO_EDGE_SECRET,
        OPERATOR_POLICY_HMAC_SECRET: walletProofSecret(process.env),
      } as NodeJS.ProcessEnv;
      const oblast = await gateProtectedWrite({
        headers: {
          "x-reactor-wallet-proof": await signProof(clearAcct),
          "x-reactor-wallet": CLAIMED_CLEAR,
          "cf-ipcountry": "UA",
          ...signedOfficialGeoHeaders({ country: "UA", region: "UA-14" }),
        },
        env: prodGeoEnv,
        surface: "quote",
      });
      assert(
        !oblast.ok && oblast.decision.reason === "UNAVAILABLE_GEO_POLICY",
        `official HMAC UA-14 oblast UNKNOWN ${JSON.stringify(oblast.ok ? oblast.decision : oblast.body)}`,
      );

      const dpr = await gateProtectedWrite({
        headers: {
          "x-reactor-wallet-proof": await signProof(clearAcct),
          "x-reactor-wallet": CLAIMED_CLEAR,
          "cf-ipcountry": "UA",
          ...signedOfficialGeoHeaders({ country: "UA", region: "UA-DPR" }),
        },
        env: prodGeoEnv,
        surface: "quote",
      });
      assert(
        !dpr.ok && dpr.decision.reason === "DENY_GEO_BLOCKED",
        `official HMAC UA-DPR DENY ${JSON.stringify(dpr.ok ? dpr.decision : dpr.body)}`,
      );

      const usAllow = await gateProtectedWrite({
        headers: {
          "x-reactor-wallet-proof": await signProof(clearAcct),
          "cf-ipcountry": "IR",
          ...signedOfficialGeoHeaders({ country: "US" }),
        },
        env: prodGeoEnv,
        surface: "quote",
      });
      assert(usAllow.ok && usAllow.wallet === CLEAR, `official HMAC US ALLOW ${JSON.stringify(usAllow.ok ? usAllow.decision : usAllow)}`);
    } finally {
      if (prevDataDir === undefined) delete process.env.SANCTIONS_DATA_DIR;
      else process.env.SANCTIONS_DATA_DIR = prevDataDir;
      rmSync(dataDir, { recursive: true, force: true });
      bindOperatorPolicyProviders(null);
      resetOperatorPolicyState();
      setFixtureBlockedWallets([BLOCKED]);
    }
  }

  {
    const prod = await gateProtectedWrite({
      headers: { "cf-ipcountry": "US", "x-sanctions-clear": "1", "x-reactor-wallet": CLAIMED_CLEAR },
      body: spoofBody(),
      env: { REACTOR_ENV: "PROD" },
      surface: "launch.authorize",
    });
    assert(!prod.ok, "PROD without official plugins fail-closes");
    assert(prod.status === 403 || prod.status === 503, "PROD closed");
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
    const after = indexSrc.slice(idx, idx + 2800);
    assert(after.includes("gateProtectedWrite"), `${path} calls gateProtectedWrite`);
    if (path === "/launch/authorize") {
      assert(after.indexOf("gateProtectedWrite") < after.indexOf("authorizeLaunch"), "authorize gated before sign");
      assert(after.includes("bindRecoveredIdentity"), "authorize binds recovered signer");
    }
    if (path === "/quote") {
      assert(after.indexOf("gateProtectedWrite") < after.indexOf("buildQuote"), "quote gated before ticket");
      assert(after.includes("bindRecoveredIdentity"), "quote binds recipient to recovered signer");
    }
    if (path === "/upload") {
      assert(after.indexOf("gateProtectedWrite") < after.indexOf("media.put"), "upload gated before store");
      assert(after.includes("wallet: gate.wallet"), "upload attributes recovered signer");
    }
  }
  assert(indexSrc.includes("/operator-policy/challenge"), "challenge route mounted");
  assert(indexSrc.includes("/operator-policy/status"), "status route mounted");
  assert(indexSrc.includes("readOperatorPolicyStatus"), "status uses shared reader");
  assert(indexSrc.includes("/sanctions/screen"), "preserves #66 screen lookup");
  assert(indexSrc.includes("/sanctions/dataset"), "preserves #66 dataset lookup");
  assert(indexSrc.includes("indexerSanctionsStore"), "preserves #66 store constructor");
  assert(indexSrc.includes("screenWithSharedOfficialStore"), "shared #61 store keeps LOCAL fixture screen");
  assert(readFileSync(join(here, "geo-policy-resolve.ts"), "utf8").includes("export function evaluateRequestGeo"), "official #67 geo plugin present");
  assert(signerSrc.includes("gateProtectedWrite"), "isolated signer gated");
  assert(signerSrc.includes("bindRecoveredIdentity"), "signer binds recovered creator");
}

console.log("operator-policy http matrix ok");
