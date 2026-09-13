/**
 * Production integration gate for #62.
 *
 * Starts the real indexer (`apps/indexer/src/index.ts`) and production Next
 * (`next build` + `next start` `/api/launch-pricing`). Hits mounted HTTP
 * routes — not `gateProtectedWrite` helpers and not `proxyLaunchAuthorize()`.
 *
 * Next never injects geo. A test reverse-proxy stands in for the indexer edge
 * and attaches LOCAL `x-reactor-geo-fixture` (or HMAC in a later env).
 *
 * Full CI only (`pnpm test:operator-policy-http`). Not on `test:lib`.
 */
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import sharp from "sharp";
import { OPERATOR_POLICY_DISCLAIMER } from "../packages/reactor/src/sanctions-policy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLAIMED_CLEAR = "0x1111111111111111111111111111111111111111";
const blockedAcct = privateKeyToAccount(generatePrivateKey());
const clearAcct = privateKeyToAccount(generatePrivateKey());
const BLOCKED = blockedAcct.address.toLowerCase();
const CLEAR = clearAcct.address.toLowerCase();
const HMAC = "test-operator-policy-hmac-secret";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type Hit = { status: number; json: Record<string, unknown>; raw: string };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

async function waitHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok || res.status === 404 || res.status === 405) return;
      last = `${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}: ${last}`);
}

function hit(
  base: string,
  opts: { method?: string; path: string; body?: unknown; headers?: Record<string, string>; rawBody?: Buffer },
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const raw =
      opts.rawBody ??
      (opts.body === undefined ? undefined : Buffer.from(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)));
    const headers: Record<string, string> = { ...opts.headers };
    if (raw && !headers["content-type"]) headers["content-type"] = "application/json";
    if (raw) headers["content-length"] = String(raw.length);
    const req = httpRequest(new URL(opts.path, base), { method: opts.method ?? "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(text || "{}") as Record<string, unknown>;
        } catch {
          json = { parseError: text };
        }
        resolve({ status: res.statusCode ?? 0, json, raw: text });
      });
    });
    req.on("error", reject);
    if (raw) req.end(raw);
    else req.end();
  });
}

function spawnLogged(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): ChildProcess {
  const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `${cmd} ${args[0] ?? ""}`;
  child.stdout?.on("data", (b) => {
    if (process.env.OPERATOR_POLICY_HTTP_LOG === "1") process.stdout.write(`[${prefix}] ${b}`);
  });
  child.stderr?.on("data", (b) => {
    if (process.env.OPERATOR_POLICY_HTTP_LOG === "1") process.stderr.write(`[${prefix}] ${b}`);
  });
  return child;
}

function stop(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

function startEdge(indexer: string, geoFixture: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const target = new URL(req.url ?? "/", indexer);
    const headers = { ...req.headers, host: target.host, "x-reactor-geo-fixture": geoFixture };
    const up = httpRequest(target, { method: req.method, headers }, (proxied) => {
      res.writeHead(proxied.statusCode ?? 502, proxied.headers);
      proxied.pipe(res);
    });
    up.on("error", (e) => {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: String(e) }));
    });
    req.pipe(up);
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

async function liveProof(indexer: string, account: { signMessage: (a: { message: string }) => Promise<string> }): Promise<string> {
  const issued = await hit(indexer, { path: "/operator-policy/challenge" });
  assert(issued.status === 200 && typeof issued.json.token === "string" && typeof issued.json.message === "string", `challenge ${issued.raw}`);
  const signature = await account.signMessage({ message: String(issued.json.message) });
  return JSON.stringify({ token: issued.json.token, signature });
}

function spoofHeaders(proof: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-reactor-wallet-proof": proof,
    "x-reactor-wallet": CLAIMED_CLEAR,
    "x-sanctions-clear": "1",
    "cf-ipcountry": extra["cf-ipcountry"] ?? "IR",
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
    ticker: "CAT",
    name: "Cat",
    ...extra,
  };
}

function assertPolicyDeny(res: Hit, reason: string, label: string): void {
  assert(res.status === 403 || res.status === 503, `${label} status ${res.status} ${res.raw}`);
  assert(res.json.reason === reason, `${label} reason ${res.json.reason} != ${reason} ${res.raw}`);
  assert(res.json.ok === false, `${label} ok`);
  assert(typeof res.json.error === "string" && String(res.json.error).length > 0, `${label} user error`);
  assert(res.json.disclaimer === OPERATOR_POLICY_DISCLAIMER, `${label} disclaimer`);
  assert(!res.raw.includes(CLAIMED_CLEAR), `${label} leaked claimed wallet`);
  assert(!res.raw.includes(BLOCKED) && !res.raw.includes(CLEAR), `${label} leaked subject`);
  assert(!/"signature"\s*:\s*"0x/.test(res.raw), `${label} leaked signature`);
  assert(!res.raw.includes("CANARY"), `${label} leaked canary`);
  assert(!("tx" in res.json) && !("amountOut" in res.json) && !("publicUrl" in res.json) && !("uri" in res.json), `${label} leaked write payload`);
}

function assertPastGate(res: Hit, label: string): void {
  assert(res.json.reason !== "DENY_ADDRESS_BLOCKED", `${label} must not be address deny ${res.raw}`);
  assert(res.json.reason !== "DENY_GEO_BLOCKED", `${label} must not be geo deny ${res.raw}`);
  assert(res.json.reason !== "UNAVAILABLE_WALLET_MISSING", `${label} must not be missing proof ${res.raw}`);
  assert(res.json.reason !== "UNAVAILABLE_WALLET_PROOF", `${label} must not be bad proof ${res.raw}`);
}

function indexerEnv(port: number, dataDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    REACTOR_ENV: "LOCAL",
    NODE_ENV: "development",
    INDEXER_PORT: String(port),
    INDEXER_DB: join(dataDir, "reactor.sqlite"),
    SANCTIONS_DATA_DIR: join(dataDir, "sanctions"),
    OPERATOR_POLICY_BLOCKED_WALLETS: BLOCKED,
    OPERATOR_POLICY_DATASET_FRESHNESS: extra.OPERATOR_POLICY_DATASET_FRESHNESS ?? "current",
    OPERATOR_POLICY_HMAC_SECRET: HMAC,
    GEO_EDGE_SECRET: "geo-edge-secret-ok!!",
    RPC_URL: "http://127.0.0.1:9",
    NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:9",
    QUOTE_RPM: "1000",
    UPLOAD_RPM: "1000",
    PRICING_RPM: "1000",
    ...extra,
  };
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), "op-http-"));
  const staleDir = mkdtempSync(join(tmpdir(), "op-http-stale-"));
  const children: ChildProcess[] = [];
  let edge: { url: string; close: () => Promise<void> } | undefined;
  let edgeFx: { url: string; close: () => Promise<void> } | undefined;
  try {
    const PNG = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 16, g: 16, b: 16 } },
    })
      .png()
      .toBuffer();

    const indexerPort = await freePort();
    const stalePort = await freePort();
    const webPort = await freePort();
    const indexerUrl = `http://127.0.0.1:${indexerPort}`;
    const staleUrl = `http://127.0.0.1:${stalePort}`;

    const indexer = spawnLogged("pnpm", ["exec", "tsx", "src/index.ts"], indexerEnv(indexerPort, work), join(root, "apps/indexer"));
    children.push(indexer);
    await waitHttp(`${indexerUrl}/health`, 45_000);

    const health = await hit(indexerUrl, { path: "/health" });
    assert(health.status === 200 && health.json.ok === true, `real /health ${health.raw}`);
    const markets = await hit(indexerUrl, { path: "/markets" });
    assert(markets.status === 200 && !("reason" in markets.json && String(markets.json.reason).startsWith("DENY_")), `public /markets ${markets.raw}`);
    const ticker = await hit(indexerUrl, { path: "/ticker/CAT" });
    assert(ticker.status === 200, `public /ticker ${ticker.raw}`);
    const screen = await hit(indexerUrl, { path: `/sanctions/screen?address=${CLAIMED_CLEAR}` });
    assert(screen.status === 200 || screen.status === 400, `public /sanctions/screen ${screen.raw}`);
    const challenge = await hit(indexerUrl, { path: "/operator-policy/challenge" });
    assert(challenge.status === 200 && typeof challenge.json.token === "string", `public challenge ${challenge.raw}`);

    const blockedProof = await liveProof(indexerUrl, blockedAcct);
    const clearProof = await liveProof(indexerUrl, clearAcct);

    const writes = [
      { method: "POST" as const, path: "/quote", body: spoofBody({ token: CLAIMED_CLEAR, amountIn: "1" }) },
      { method: "POST" as const, path: "/launch/authorize", body: spoofBody() },
      { method: "POST" as const, path: "/launch/admit", body: spoofBody() },
    ];

    for (const w of writes) {
      const denied = await hit(indexerUrl, {
        ...w,
        headers: spoofHeaders(blockedProof),
      });
      assertPolicyDeny(denied, "DENY_ADDRESS_BLOCKED", `blocked wallet ${w.path}`);
    }

    {
      const up = await hit(indexerUrl, {
        method: "POST",
        path: "/upload",
        rawBody: PNG,
        headers: { ...spoofHeaders(blockedProof), "content-type": "image/png" },
      });
      assertPolicyDeny(up, "DENY_ADDRESS_BLOCKED", "blocked wallet /upload");
    }

    for (const w of writes) {
      const denied = await hit(indexerUrl, {
        ...w,
        headers: spoofHeaders(clearProof, { "x-reactor-geo-fixture": "FX", "cf-ipcountry": "US" }),
      });
      assertPolicyDeny(denied, "DENY_GEO_BLOCKED", `blocked geo ${w.path}`);
    }

    for (const w of writes) {
      const missing = await hit(indexerUrl, {
        ...w,
        headers: spoofHeaders("not-a-proof"),
      });
      assert(
        missing.json.reason === "UNAVAILABLE_WALLET_MISSING" || missing.json.reason === "UNAVAILABLE_WALLET_PROOF",
        `missing/invalid proof ${w.path} ${missing.raw}`,
      );
      assertPolicyDeny(missing, String(missing.json.reason), `proof ${w.path}`);
    }

    {
      const quote = await hit(indexerUrl, {
        method: "POST",
        path: "/quote",
        body: spoofBody({ token: CLAIMED_CLEAR, amountIn: "1" }),
        headers: spoofHeaders(clearProof),
      });
      assertPastGate(quote, "allow /quote");
      assert(quote.status !== 403 || !String(quote.json.reason ?? "").startsWith("DENY_"), `allow /quote still policy-denied ${quote.raw}`);
    }

    {
      const auth = await hit(indexerUrl, {
        method: "POST",
        path: "/launch/authorize",
        body: spoofBody(),
        headers: spoofHeaders(clearProof),
      });
      assertPastGate(auth, "allow /launch/authorize");
    }

    {
      const up = await hit(indexerUrl, {
        method: "POST",
        path: "/upload",
        rawBody: PNG,
        headers: { ...spoofHeaders(clearProof), "content-type": "image/png" },
      });
      assert(up.status === 200 && typeof up.json.publicUrl === "string", `allow /upload ${up.raw}`);
      assert(String(up.json.wallet).toLowerCase() === CLEAR, `upload wallet rebound ${up.raw}`);
      assert(!String(up.json.wallet).toLowerCase().includes(CLAIMED_CLEAR.slice(2)), "upload not claimed wallet");
    }

    {
      const statusBlocked = await hit(indexerUrl, {
        path: "/operator-policy/status",
        headers: spoofHeaders(blockedProof),
      });
      assertPolicyDeny(statusBlocked, "DENY_ADDRESS_BLOCKED", "status blocked");
      const statusAllow = await hit(indexerUrl, {
        path: "/operator-policy/status",
        headers: spoofHeaders(clearProof),
      });
      assert(statusAllow.status === 200 && statusAllow.json.reason === "ALLOW", `status allow ${statusAllow.raw}`);
    }

    const staleIndexer = spawnLogged(
      "pnpm",
      ["exec", "tsx", "src/index.ts"],
      indexerEnv(stalePort, staleDir, { OPERATOR_POLICY_DATASET_FRESHNESS: "stale" }),
      join(root, "apps/indexer"),
    );
    children.push(staleIndexer);
    await waitHttp(`${staleUrl}/health`, 45_000);
    const staleProof = await liveProof(staleUrl, clearAcct);
    const stale = await hit(staleUrl, {
      method: "POST",
      path: "/quote",
      body: spoofBody({ token: CLAIMED_CLEAR, amountIn: "1" }),
      headers: spoofHeaders(staleProof),
    });
    assertPolicyDeny(stale, "UNAVAILABLE_DATASET_STALE", "stale dataset /quote");

    edge = await startEdge(indexerUrl, "US");
    edgeFx = await startEdge(indexerUrl, "FX");

    if (!process.env.E2E_SKIP_BUILD || !existsSync(join(root, "apps/web/.next"))) {
      const build = spawnLogged(
        "pnpm",
        ["build"],
        {
          ...process.env,
          NODE_ENV: "production",
          NEXT_PUBLIC_REVIEW_FIXTURES: "1",
          NEXT_PUBLIC_INDEXER_URL: edge.url,
          INDEXER_URL: edge.url,
        },
        join(root, "apps/web"),
      );
      const buildCode = await new Promise<number>((resolve, reject) => {
        build.on("exit", (code) => resolve(code ?? 1));
        build.on("error", reject);
      });
      assert(buildCode === 0, "next build failed");
    }

    const web = spawnLogged(
      "pnpm",
      ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
      {
        ...process.env,
        NODE_ENV: "production",
        NEXT_PUBLIC_REVIEW_FIXTURES: "1",
        NEXT_PUBLIC_INDEXER_URL: edge.url,
        INDEXER_URL: edge.url,
      },
      join(root, "apps/web"),
    );
    children.push(web);
    const nextUrl = `http://127.0.0.1:${webPort}`;
    await waitHttp(nextUrl, 45_000);

    const nextProofBlocked = await liveProof(indexerUrl, blockedAcct);
    const nextProofClear = await liveProof(indexerUrl, clearAcct);

    const nextBlocked = await hit(nextUrl, {
      method: "POST",
      path: "/api/launch-pricing",
      body: spoofBody(),
      headers: spoofHeaders(nextProofBlocked, { "cf-ipcountry": "US" }),
    });
    assertPolicyDeny(nextBlocked, "DENY_ADDRESS_BLOCKED", "Next /api/launch-pricing blocked wallet");

    const nextMissing = await hit(nextUrl, {
      method: "POST",
      path: "/api/launch-pricing",
      body: spoofBody(),
      headers: { "x-sanctions-clear": "1", "cf-ipcountry": "US" },
    });
    assertPolicyDeny(nextMissing, "UNAVAILABLE_WALLET_MISSING", "Next missing proof");

    const nextAllow = await hit(nextUrl, {
      method: "POST",
      path: "/api/launch-pricing",
      body: spoofBody(),
      headers: spoofHeaders(nextProofClear, { "cf-ipcountry": "IR" }),
    });
    assertPastGate(nextAllow, "Next allow (edge US fixture)");

    stop(web);
    await new Promise((r) => setTimeout(r, 400));
    const webFx = spawnLogged(
      "pnpm",
      ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
      {
        ...process.env,
        NODE_ENV: "production",
        NEXT_PUBLIC_REVIEW_FIXTURES: "1",
        NEXT_PUBLIC_INDEXER_URL: edgeFx.url,
        INDEXER_URL: edgeFx.url,
      },
      join(root, "apps/web"),
    );
    children.push(webFx);
    await waitHttp(nextUrl, 45_000);
    const nextGeo = await hit(nextUrl, {
      method: "POST",
      path: "/api/launch-pricing",
      body: spoofBody(),
      headers: spoofHeaders(await liveProof(indexerUrl, clearAcct), { "cf-ipcountry": "US" }),
    });
    assertPolicyDeny(nextGeo, "DENY_GEO_BLOCKED", "Next blocked geo via indexer edge");
  } finally {
    for (const c of children) stop(c);
    await edge?.close().catch(() => undefined);
    await edgeFx?.close().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
    rmSync(staleDir, { recursive: true, force: true });
  }

  console.log("operator-policy production HTTP integration ok");
}

void main();
