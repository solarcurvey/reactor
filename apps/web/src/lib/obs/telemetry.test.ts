process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { acceptIngestedEvent, addTelemetrySink, buildTelemetryEvent, reportFailure, resetTelemetryForTests } from "./telemetry.ts";
import {
  allowTelemetryIngest,
  resetTelemetryIngestRateForTests,
  TELEMETRY_RATE_MAX_PROD,
  telemetryRateMax,
} from "./ingest-rate.ts";
import { classifyUrl, safePath } from "./kinds.ts";
import { releaseId, releaseInfo } from "./release.ts";
import { parseSentryDsn, toSentryStorePayload } from "./sentry.ts";
import { containsResidualSecret } from "./redact.ts";
import { ANVIL_ACCOUNT0_PK } from "../secret-sentinel.ts";

const ANVIL_PK = `0x${ANVIL_ACCOUNT0_PK}`;
const SIG = "0x" + "ab".repeat(65);

resetTelemetryForTests();

{
  assert.equal(classifyUrl("http://127.0.0.1:43148/quote"), "quote");
  assert.equal(classifyUrl("http://127.0.0.1:43148/upload"), "media");
  assert.equal(classifyUrl(`${"http://127.0.0.1:43148"}/stream`), "sse");
  assert.equal(classifyUrl("/api/launch-pricing"), "api");
  assert.equal(classifyUrl("http://127.0.0.1:43148/markets?limit=80"), "api");
  assert.equal(safePath("http://127.0.0.1:43148/quote?token=secret"), "/quote");
}

{
  const prevSha = process.env.NEXT_PUBLIC_BUILD_SHA;
  const prevProto = process.env.NEXT_PUBLIC_PROTOCOL_VERSION;
  const prevEnv = process.env.NEXT_PUBLIC_REACTOR_ENV;
  const prevTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  const prevChain = process.env.NEXT_PUBLIC_CHAIN_ID;
  const prevName = process.env.NEXT_PUBLIC_CHAIN_NAME;
  process.env.NEXT_PUBLIC_BUILD_SHA = "e3bbada5cafe0001";
  process.env.NEXT_PUBLIC_PROTOCOL_VERSION = "0.3.4";
  process.env.NEXT_PUBLIC_REACTOR_ENV = "LOCAL";
  process.env.NEXT_PUBLIC_BUILD_TIME = "2026-09-12T19:34:00.000Z";
  process.env.NEXT_PUBLIC_CHAIN_ID = "5042002";
  process.env.NEXT_PUBLIC_CHAIN_NAME = "REACTOR local (Arc-compatible)";
  const rel = releaseInfo();
  assert.equal(rel.release, "reactor@0.3.4+e3bbada5cafe0001");
  assert.equal(rel.release, releaseId(rel.buildSha, rel.protocolVersion));
  assert.equal(rel.protocolVersion, "0.3.4");
  assert.equal(rel.factoryVersion, 1);
  assert.equal(rel.env, "local");
  assert.equal(rel.reactorEnv, "LOCAL");
  assert.equal(rel.chainId, 5042002);
  assert.equal(rel.chainName, "REACTOR local (Arc-compatible)");
  assert.equal(rel.buildTimestamp, "2026-09-12T19:34:00.000Z");
  if (prevSha === undefined) delete process.env.NEXT_PUBLIC_BUILD_SHA;
  else process.env.NEXT_PUBLIC_BUILD_SHA = prevSha;
  if (prevProto === undefined) delete process.env.NEXT_PUBLIC_PROTOCOL_VERSION;
  else process.env.NEXT_PUBLIC_PROTOCOL_VERSION = prevProto;
  if (prevEnv === undefined) delete process.env.NEXT_PUBLIC_REACTOR_ENV;
  else process.env.NEXT_PUBLIC_REACTOR_ENV = prevEnv;
  if (prevTime === undefined) delete process.env.NEXT_PUBLIC_BUILD_TIME;
  else process.env.NEXT_PUBLIC_BUILD_TIME = prevTime;
  if (prevChain === undefined) delete process.env.NEXT_PUBLIC_CHAIN_ID;
  else process.env.NEXT_PUBLIC_CHAIN_ID = prevChain;
  if (prevName === undefined) delete process.env.NEXT_PUBLIC_CHAIN_NAME;
  else process.env.NEXT_PUBLIC_CHAIN_NAME = prevName;
}

{
  const rel = releaseInfo();
  assert.match(rel.release, /^reactor@\d+\.\d+\.\d+\+/);
  assert.equal(rel.release, releaseId(rel.buildSha, rel.protocolVersion));
  assert.equal(rel.factoryVersion, 1);
  assert.equal(typeof rel.reactorEnv, "string");
  assert.equal(rel.chainId, 5042002);
  assert.equal(typeof rel.chainName, "string");
  assert.ok(rel.chainName.length > 0);
  const ev = buildTelemetryEvent("exception", "quote", new Error(`quote failed pk=${ANVIL_PK}`), {
    signature: SIG,
    turnstile: "cf-secret",
    path: "/quote",
  });
  assert.equal(ev.release, rel.release);
  assert.equal(ev.buildSha, rel.buildSha);
  assert.equal(ev.kind, "quote");
  assert.equal(ev.message.includes(ANVIL_PK), false);
  assert.equal(JSON.stringify(ev).includes("cf-secret"), false);
  assert.equal(JSON.stringify(ev).includes(SIG.slice(2, 20)), false);
  assert.equal(containsResidualSecret(ev), false);
}

{
  const seen: unknown[] = [];
  const stop = addTelemetrySink((e) => {
    seen.push(e);
  });
  const a = reportFailure("wallet", new Error("user rejected"));
  const b = reportFailure("wallet", new Error("user rejected"));
  assert.equal(a.kind, "wallet");
  assert.equal(seen.length, 1, "identical wallet errors dedupe inside 8s");
  void b;
  stop();
  resetTelemetryForTests();
}

{
  const ingested = acceptIngestedEvent({
    type: "exception",
    kind: "tx",
    message: `Trade failed ${ANVIL_PK}`,
    extra: { signature: SIG },
    release: "reactor@0.0.0+deadbeef",
    protocolVersion: "0.0.0",
    factoryVersion: 1,
    buildSha: "deadbeef",
    env: "test",
    ts: 1,
  });
  assert.ok(ingested);
  assert.equal(ingested.message.includes(ANVIL_PK), false);
  assert.equal(JSON.stringify(ingested.extra).includes("abababab"), false);
}

{
  assert.equal(acceptIngestedEvent({ type: "exception", kind: "nope", message: "x" }), null);
  assert.equal(acceptIngestedEvent({ type: "exception", kind: "api" }), null);
}

{
  const prevReview = process.env.NEXT_PUBLIC_REVIEW_FIXTURES;
  const prevRelaxed = process.env.REACTOR_TELEMETRY_RELAXED;
  delete process.env.NEXT_PUBLIC_REVIEW_FIXTURES;
  delete process.env.REACTOR_TELEMETRY_RELAXED;
  resetTelemetryIngestRateForTests();
  assert.equal(telemetryRateMax(), TELEMETRY_RATE_MAX_PROD);
  const t0 = 1_000_000;
  for (let i = 0; i < TELEMETRY_RATE_MAX_PROD; i++) {
    assert.equal(allowTelemetryIngest("qa-ip", t0 + i), true, `prod hit ${i} allowed`);
  }
  assert.equal(allowTelemetryIngest("qa-ip", t0 + TELEMETRY_RATE_MAX_PROD), false, "prod 41st hit is 429");
  assert.equal(allowTelemetryIngest("other-ip", t0), true, "other IP is independent");
  process.env.REACTOR_TELEMETRY_RELAXED = "1";
  resetTelemetryIngestRateForTests();
  assert.equal(telemetryRateMax() > TELEMETRY_RATE_MAX_PROD, true, "review/CI cap is higher");
  for (let i = 0; i < TELEMETRY_RATE_MAX_PROD + 1; i++) {
    assert.equal(allowTelemetryIngest("qa-ip", t0 + i), true, `relaxed hit ${i} allowed`);
  }
  if (prevReview === undefined) delete process.env.NEXT_PUBLIC_REVIEW_FIXTURES;
  else process.env.NEXT_PUBLIC_REVIEW_FIXTURES = prevReview;
  if (prevRelaxed === undefined) delete process.env.REACTOR_TELEMETRY_RELAXED;
  else process.env.REACTOR_TELEMETRY_RELAXED = prevRelaxed;
  resetTelemetryIngestRateForTests();
}

{
  const parsed = parseSentryDsn("https://abcdefghijklmnopqrstuvwxyz123456@o1.ingest.sentry.io/123");
  assert.ok(parsed);
  assert.equal(parsed.storeUrl, "https://o1.ingest.sentry.io/api/123/store/");
  assert.equal(parseSentryDsn(""), null);
  assert.equal(parseSentryDsn("not-a-dsn"), null);
  const payload = toSentryStorePayload(
    buildTelemetryEvent("exception", "rpc", new Error("eth_call failed"), { path: "/rpc" }),
  );
  const tags = payload.tags as {
    kind: string;
    reactor_env: string;
    chain_id: string;
    chain_name: string;
    build_time: string;
  };
  assert.equal(tags.kind, "rpc");
  assert.equal(typeof tags.reactor_env, "string");
  assert.equal(tags.chain_id, String(releaseInfo().chainId));
  assert.ok(tags.chain_name.length > 0);
  assert.ok(typeof tags.build_time === "string");
  assert.equal(typeof payload.release, "string");
  assert.match(String(payload.release), /^reactor@/);
}

{
  const root = join(process.cwd(), "apps/web/src");
  const files = [
    "app/error.tsx",
    "app/global-error.tsx",
    "app/trade/error.tsx",
    "app/launch/error.tsx",
    "app/token/[address]/error.tsx",
    "app/reactor/error.tsx",
    "app/core/error.tsx",
    "app/rewards/error.tsx",
    "app/wallet/error.tsx",
    "app/quote/[symbol]/error.tsx",
    "app/fair/[id]/error.tsx",
    "app/docs/error.tsx",
    "app/ops/error.tsx",
    "app/search/error.tsx",
    "app/error-preview/page.tsx",
    "app/error-preview/error.tsx",
    "app/obs-inject/page.tsx",
    "app/api/telemetry/route.ts",
    "app/api/version/route.ts",
    "lib/obs/alerts.ts",
    "lib/obs/web-vitals.ts",
    "lib/obs/wallet-errors.ts",
    "lib/obs/correlate.ts",
  ];
  for (const f of files) {
    assert.equal(existsSync(join(root, f)), true, `missing ${f}`);
  }
  const nextCfg = readFileSync(join(process.cwd(), "apps/web/next.config.ts"), "utf8");
  assert.match(nextCfg, /NEXT_PUBLIC_BUILD_SHA/);
  assert.match(nextCfg, /NEXT_PUBLIC_BUILD_TIME/);
  assert.match(nextCfg, /NEXT_PUBLIC_CHAIN_ID/);
  assert.match(nextCfg, /NEXT_PUBLIC_CHAIN_NAME/);
  assert.match(nextCfg, /productionBrowserSourceMaps|hidden-source-map|REACTOR_SOURCEMAPS/);
  const telemetryRoute = readFileSync(join(root, "app/api/telemetry/route.ts"), "utf8");
  assert.match(telemetryRoute, /readLimitedText/);
  assert.match(telemetryRoute, /acceptIngestedEvent/);
  assert.match(telemetryRoute, /allowTelemetryIngest/);
  assert.equal(telemetryRoute.includes("await req.text()"), false);
  const client = readFileSync(join(root, "lib/obs/telemetry.ts"), "utf8");
  assert.match(client, /res\.status === 429/);
  assert.match(client, /sendBeacon/);
}

async function ingestRoute() {
  const { POST } = await import("../../app/api/telemetry/route.ts");
  const req = new Request("http://127.0.0.1/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "exception",
      kind: "quote",
      message: `quote failed pk=${ANVIL_PK}`,
      extra: { turnstile: "cf-turnstile-secret", signature: SIG },
      release: "reactor@0.3.4+test",
      protocolVersion: "0.3.4",
      factoryVersion: 1,
      buildSha: "test",
      env: "test",
      ts: Date.now(),
    }),
  });
  const res = await POST(req);
  assert.equal(res.status, 200);
  const json = (await res.json()) as { ok: boolean; release: string };
  assert.equal(json.ok, true);
  assert.match(json.release, /^reactor@/);

  const bad = await POST(
    new Request("http://127.0.0.1/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "exception", kind: "nope", message: "x" }),
    }),
  );
  assert.equal(bad.status, 400);
}

void ingestRoute()
  .then(() => {
    console.log("obs/telemetry tests ok");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
