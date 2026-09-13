/**
 * Production-shaped failure injection: each outage class fires a telemetry hook
 * while Anvil / mnemonic / signature sentinels stay redacted. Wallet 4001 never pages.
 */
process.env.NODE_ENV = "production";
process.env.REACTOR_ENV = "LOCAL";
process.env.NEXT_PUBLIC_REACTOR_ENV = "LOCAL";
process.env.NEXT_PUBLIC_BUILD_SHA = "e3bbada5cafe0001";
process.env.NEXT_PUBLIC_PROTOCOL_VERSION = "0.3.4";
process.env.NEXT_PUBLIC_BUILD_TIME = "2026-09-12T19:34:00.000Z";
process.env.NEXT_PUBLIC_CHAIN_ID = "5042002";
process.env.NEXT_PUBLIC_CHAIN_NAME = "REACTOR local (Arc-compatible)";

import assert from "node:assert/strict";
import {
  addTelemetrySink,
  reportFailure,
  resetTelemetryForTests,
  releaseInfo,
  shouldPageOperator,
  isUserRejection,
  WALLET_USER_REJECTED,
  kindToOutageClass,
  ALERT_THRESHOLDS,
  OUTAGE_CLASSES,
  containsResidualSecret,
  isCorePerfPage,
  WEB_VITAL_BUDGETS,
  buildVitalSample,
  ratingFor,
  formatSupportRef,
  maybeSimulation,
} from "./index.ts";
import type { FailureKind } from "./kinds.ts";
import { ANVIL_ACCOUNT0_PK } from "../secret-sentinel.ts";
import { anvilAccount0PkHex, anvilMnemonic } from "./inject-sentinels.ts";

const ANVIL_PK = `0x${ANVIL_ACCOUNT0_PK}`;
const SIG = "0x" + "ab".repeat(65);
const MNEMONIC = anvilMnemonic();

assert.equal(anvilAccount0PkHex(), ANVIL_ACCOUNT0_PK, "inject sentinel matches Anvil #0");
assert.equal(MNEMONIC, "test test test test test test test test test test test junk");

function noSecrets(value: unknown, label: string) {
  const s = JSON.stringify(value);
  assert.equal(s.includes(ANVIL_PK), false, `${label} leaked anvil pk`);
  assert.equal(s.includes(ANVIL_PK.slice(2)), false, `${label} leaked anvil pk hex`);
  assert.equal(s.includes(MNEMONIC), false, `${label} leaked mnemonic`);
  assert.equal(s.includes("cf-inject-secret"), false, `${label} leaked turnstile`);
  assert.equal(s.includes("abababababab"), false, `${label} leaked sig`);
  assert.equal(containsResidualSecret(value), false, `${label} residual secret`);
}

{
  const rel = releaseInfo();
  assert.equal(rel.protocolVersion, "0.3.4");
  assert.equal(rel.buildSha, "e3bbada5cafe0001");
  assert.equal(rel.release, "reactor@0.3.4+e3bbada5cafe0001");
  assert.equal(rel.env, "local");
  assert.equal(rel.reactorEnv, "LOCAL");
  assert.equal(rel.chainId, 5042002);
  assert.equal(rel.chainName, "REACTOR local (Arc-compatible)");
  assert.equal(rel.buildTimestamp, "2026-09-12T19:34:00.000Z");
  assert.equal(rel.factoryVersion, 1);
}

{
  resetTelemetryForTests();
  const seen: Array<ReturnType<typeof reportFailure>> = [];
  const stop = addTelemetrySink((e) => {
    seen.push(e);
  });

  const injections: Array<{ kind: FailureKind; message: string }> = [
    { kind: "ui", message: `render inject pk=${ANVIL_PK} mnemonic=${MNEMONIC}` },
    { kind: "api", message: `api inject pk=${ANVIL_PK} mnemonic=${MNEMONIC}` },
    { kind: "rpc", message: `rpc inject pk=${ANVIL_PK} mnemonic=${MNEMONIC}` },
    { kind: "quote", message: `quote inject pk=${ANVIL_PK} mnemonic=${MNEMONIC}` },
    { kind: "sse", message: `sse inject pk=${ANVIL_PK} mnemonic=${MNEMONIC}` },
    { kind: "quote", message: `eth_call simulation reverted pk=${ANVIL_PK}` },
  ];

  for (const row of injections) {
    const ev = reportFailure(row.kind, new Error(row.message), {
      signature: SIG,
      turnstile: "cf-inject-secret",
      mnemonic: MNEMONIC,
      privateKey: ANVIL_PK,
      route: "/trade",
    });
    noSecrets(ev, `${row.kind}:${row.message.slice(0, 24)}`);
    assert.equal(ev.reactorEnv, "LOCAL");
    assert.equal(ev.chainId, 5042002);
    assert.equal(ev.chainName, "REACTOR local (Arc-compatible)");
    assert.equal(ev.buildTimestamp, "2026-09-12T19:34:00.000Z");
    assert.equal(ev.release, "reactor@0.3.4+e3bbada5cafe0001");
    assert.match(ev.traceId, /^[0-9a-f]{8,16}$/i);
    assert.match(formatSupportRef(ev), /ref /);
    assert.match(formatSupportRef(ev), /chain 5042002/);
  }

  const sim = seen.find((e) => e.kind === "simulation");
  assert.ok(sim, "simulation hook must fire from eth_call quote text");
  assert.equal(sim.outageClass, "simulation");
  assert.equal(
    seen.some((e) => e.kind === "ui"),
    true,
  );
  assert.equal(
    seen.some((e) => e.kind === "api"),
    true,
  );
  assert.equal(
    seen.some((e) => e.kind === "rpc"),
    true,
  );
  assert.equal(
    seen.some((e) => e.kind === "quote"),
    true,
  );
  assert.equal(
    seen.some((e) => e.kind === "sse"),
    true,
  );

  stop();
  resetTelemetryForTests();
}

{
  const rejected = Object.assign(new Error("User rejected the request."), { code: WALLET_USER_REJECTED });
  assert.equal(isUserRejection(rejected), true);
  assert.equal(isUserRejection({ code: 4001, message: "denied" }), true);
  assert.equal(isUserRejection({ name: "UserRejectedRequestError", message: "x" }), true);
  assert.equal(isUserRejection(new Error("RPC timeout")), false);

  const decision = shouldPageOperator({ kind: "wallet", at: Date.now(), err: rejected });
  assert.equal(decision.page, false);
  assert.equal(decision.suppressedUserRejection, true);
  assert.match(decision.reason, /4001|user-rejection/);

  resetTelemetryForTests();
  const seen: Array<{ page: boolean; pagingReason?: string; kind: string }> = [];
  const stop = addTelemetrySink((e) => seen.push(e));
  const ev = reportFailure("wallet", rejected, { action: "connect" });
  assert.equal(ev.page, false);
  assert.match(String(ev.pagingReason), /4001|user-rejection/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.page, false);
  noSecrets(ev, "wallet-4001");
  stop();
  resetTelemetryForTests();
}

{
  for (const c of OUTAGE_CLASSES) {
    assert.ok(ALERT_THRESHOLDS[c].count >= 2);
    assert.ok(ALERT_THRESHOLDS[c].consecutive >= 2);
    assert.ok(ALERT_THRESHOLDS[c].windowMs >= 60_000);
  }
  assert.equal(kindToOutageClass("ui"), "render");
  assert.equal(kindToOutageClass("wallet"), null);
  assert.equal(kindToOutageClass("tx"), null);
  assert.equal(kindToOutageClass("simulation"), "simulation");

  const now = 1_000_000;
  const single = shouldPageOperator({ kind: "quote", at: now, err: new Error("quote 503") }, [], now);
  assert.equal(single.page, false);
  assert.equal(single.outageClass, "quote");

  const burst = Array.from({ length: 7 }, (_, i) => ({
    kind: "quote" as const,
    at: now - i * 1_000,
    err: new Error("quote 503"),
  }));
  const paged = shouldPageOperator({ kind: "quote", at: now, err: new Error("quote 503") }, burst, now);
  assert.equal(paged.page, true);

  const renderBurst = [{ kind: "ui" as const, at: now - 10, err: new Error("boom") }];
  const renderPage = shouldPageOperator({ kind: "ui", at: now, err: new Error("boom") }, renderBurst, now);
  assert.equal(renderPage.page, true);
  assert.equal(renderPage.outageClass, "render");
}

{
  assert.equal(isCorePerfPage("/"), true);
  assert.equal(isCorePerfPage("/trade"), true);
  assert.equal(isCorePerfPage("/launch"), true);
  assert.equal(isCorePerfPage("/reactor"), true);
  assert.equal(isCorePerfPage("/core"), true);
  assert.equal(isCorePerfPage("/token/0xabc"), true);
  assert.equal(isCorePerfPage("/ops"), false);
  assert.equal(isCorePerfPage("/docs"), false);
  assert.equal(WEB_VITAL_BUDGETS.LCP, 2500);
  assert.equal(WEB_VITAL_BUDGETS.INP, 200);
  assert.equal(WEB_VITAL_BUDGETS.CLS, 0.1);
  assert.equal(WEB_VITAL_BUDGETS.FCP, 1800);
  assert.equal(WEB_VITAL_BUDGETS.TTFB, 800);
  assert.equal(ratingFor("LCP", 1200), "good");
  assert.equal(buildVitalSample("LCP", 3000, "/trade").overBudget, true);
}

{
  assert.equal(maybeSimulation("quote", new Error("eth_call failed")), "simulation");
  assert.equal(maybeSimulation("quote", new Error("Quote API unavailable")), "quote");
  assert.equal(maybeSimulation("ui", new Error("eth_call failed")), "ui");
}

console.log("obs/failure-injection tests ok");
