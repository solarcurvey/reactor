/**
 * Configured telemetry / vendor release proof.
 * A deliberate production throw is symbolicated, POSTed to a configured DSN
 * (in-process Sentry store mock), and must come back with original frames +
 * exact release / env / chain tags. No live org token. Live Sentry remains
 * the post-merge #39 close gate — this is the documented staging vendor proof.
 */
process.env.NODE_ENV = "production";
process.env.REACTOR_ENV = "LOCAL";
process.env.NEXT_PUBLIC_REACTOR_ENV = "LOCAL";
process.env.NEXT_PUBLIC_BUILD_SHA = "91fef7d10b02370b";
process.env.NEXT_PUBLIC_PROTOCOL_VERSION = "0.3.4";
process.env.NEXT_PUBLIC_BUILD_TIME = "2026-09-12T20:18:00.000Z";
process.env.NEXT_PUBLIC_CHAIN_ID = "5042002";
process.env.NEXT_PUBLIC_CHAIN_NAME = "REACTOR local (Arc-compatible)";

import assert from "node:assert/strict";
import vm from "node:vm";
import {
  encodeMappings,
  symbolicateError,
  type SourceMapJson,
} from "./sourcemap.ts";
import { addTelemetrySink, releaseInfo, reportFailure, resetTelemetryForTests } from "./index.ts";
import { parseSentryDsn, sentryFramesFromResolved } from "./sentry.ts";
import { expectedVendorStoreUrl, proveConfiguredVendorRelease, STAGING_VENDOR_DSN } from "./vendor-proof.ts";

const ORIGINAL = `export function probeBoom(): never {
  throw new Error("deliberate-obs-probe");
}
`;

const GENERATED = `"use strict";
function probeBoom() {
  throw new Error("deliberate-obs-probe");
}
`;

const map: SourceMapJson = {
  version: 3,
  file: "obs-probe.js",
  sources: ["obs-probe.ts"],
  sourcesContent: [ORIGINAL],
  names: ["probeBoom"],
  mappings: encodeMappings([
    [[0, 0, 0, 0]],
    [[0, 0, 0, 0, 0]],
    [[2, 0, 1, 2]],
  ]),
};

const parsed = parseSentryDsn(STAGING_VENDOR_DSN);
assert.ok(parsed, "staging vendor DSN must be a valid Sentry DSN");
assert.equal(parsed.projectId, "42");
assert.equal(expectedVendorStoreUrl(), "https://vendor.test/api/42/store/");

const tags = releaseInfo();
assert.equal(tags.release, "reactor@0.3.4+91fef7d10b02370b");
assert.equal(tags.reactorEnv, "LOCAL");
assert.equal(tags.chainId, 5042002);
assert.equal(tags.chainName, "REACTOR local (Arc-compatible)");
assert.equal(tags.buildTimestamp, "2026-09-12T20:18:00.000Z");

let thrown: Error | undefined;
try {
  const ctx: { Error: typeof Error; probeBoom?: () => never } = { Error };
  vm.runInNewContext(`${GENERATED}\nthis.probeBoom = probeBoom;`, ctx, { filename: "/virtual/obs-probe.js" });
  ctx.probeBoom?.();
} catch (e) {
  thrown = e as Error;
}
assert.ok(thrown);
assert.equal(thrown.message, "deliberate-obs-probe");

const symbolicated = symbolicateError(thrown, new Map([["obs-probe.js", map]]), {
  release: tags.release,
  protocolVersion: tags.protocolVersion,
  buildSha: tags.buildSha,
  reactorEnv: tags.reactorEnv,
  chainId: tags.chainId,
  chainName: tags.chainName,
  buildTimestamp: tags.buildTimestamp,
});
assert.equal(symbolicated.resolved, true);
const hit = symbolicated.frames.find((f) => f.original?.source === "obs-probe.ts");
assert.ok(hit?.original);
assert.equal(hit.original.line, 2);

resetTelemetryForTests();
const seen: ReturnType<typeof reportFailure>[] = [];
const stop = addTelemetrySink((e) => {
  seen.push(e);
});
const ev = reportFailure("ui", thrown, {
  route: "/trade",
  symbolicated: true,
  resolvedFrames: symbolicated.frames.map((f) => ({
    fn: f.generated.functionName,
    generated: `${f.generated.file.split("/").pop()}:${f.generated.line}:${f.generated.column}`,
    original: f.original ? `${f.original.source}:${f.original.line}:${f.original.column}` : null,
  })),
});
stop();
assert.equal(seen.length, 1);
assert.equal(ev.extra?.symbolicated, true);

const frames = sentryFramesFromResolved(ev.extra?.resolvedFrames);
assert.ok(frames.some((f) => f.filename === "obs-probe.ts" && f.lineno === 2));

void proveConfiguredVendorRelease(ev).then((receipt) => {
  assert.equal(receipt.ok, true);
  assert.equal(receipt.storeUrl, "https://vendor.test/api/42/store/");
  assert.match(receipt.auth ?? "", /sentry_key=abcdef0123456789/);

  assert.equal(receipt.payload.release, "reactor@0.3.4+91fef7d10b02370b");
  assert.equal(receipt.payload.environment, "local");
  assert.equal(receipt.payload.message, "deliberate-obs-probe");

  const sentryTags = receipt.payload.tags as Record<string, string>;
  assert.equal(sentryTags.build_sha, "91fef7d10b02370b");
  assert.equal(sentryTags.reactor_env, "LOCAL");
  assert.equal(sentryTags.chain_id, "5042002");
  assert.equal(sentryTags.chain_name, "REACTOR local (Arc-compatible)");
  assert.equal(sentryTags.build_time, "2026-09-12T20:18:00.000Z");

  const exception = receipt.payload.exception as {
    values: Array<{ value: string; stacktrace?: { frames: Array<{ filename: string; lineno: number }> } }>;
  };
  assert.equal(exception.values[0]?.value, "deliberate-obs-probe");
  const vendorFrames = exception.values[0]?.stacktrace?.frames ?? [];
  assert.ok(
    vendorFrames.some((f) => f.filename === "obs-probe.ts" && f.lineno === 2),
    "configured vendor store must receive the symbolicated original frame",
  );

  console.log("obs/vendor-proof tests ok");
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
