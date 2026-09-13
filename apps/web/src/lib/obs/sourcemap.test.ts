/**
 * Source-map AC: a deliberately generated production error must resolve
 * back to original source and carry exact release SHA / env / chain tags.
 * A no-op-capable uploader alone is not enough.
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
  decodeVlq,
  encodeMappings,
  encodeVlq,
  parseStackFrames,
  planSourcemapUpload,
  resolveFrame,
  symbolicateError,
  type SourceMapJson,
} from "./sourcemap.ts";
import { addTelemetrySink, releaseInfo, reportFailure, resetTelemetryForTests } from "./index.ts";
import { toSentryStorePayload } from "./sentry.ts";

{
  for (let n = -64; n <= 64; n++) {
    const enc = encodeVlq(n);
    const dec = decodeVlq(enc, 0);
    assert.equal(dec.value, n, `vlq roundtrip ${n} => ${enc}`);
    assert.equal(dec.next, enc.length);
  }
}

const ORIGINAL = `export function probeBoom(): never {
  throw new Error("deliberate-obs-probe");
}
`;

const GENERATED = `"use strict";
function probeBoom() {
  throw new Error("deliberate-obs-probe");
}
`;

// generated line 3 col 3 (1-based throw) ← original line 2 col 3
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

{
  const orig = resolveFrame(map, 3, 9);
  assert.ok(orig, "throw frame must resolve");
  assert.equal(orig.source, "obs-probe.ts");
  assert.equal(orig.line, 2);
  assert.match(orig.sourceContent ?? "", /deliberate-obs-probe/);
}

{
  const frames = parseStackFrames("Error: deliberate-obs-probe\n    at probeBoom (/virtual/obs-probe.js:3:9)");
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.file, "/virtual/obs-probe.js");
  assert.equal(frames[0]?.line, 3);
  assert.equal(frames[0]?.column, 9);
  assert.equal(frames[0]?.functionName, "probeBoom");
}

const tags = releaseInfo();
assert.equal(tags.protocolVersion, "0.3.4");
assert.equal(tags.buildSha, "91fef7d10b02370b");
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
assert.ok(thrown, "compiled probe must throw");
assert.equal(thrown.message, "deliberate-obs-probe");
assert.match(thrown.stack ?? "", /obs-probe\.js:3:/);

const maps = new Map<string, SourceMapJson>([["obs-probe.js", map]]);
const symbolicated = symbolicateError(thrown, maps, {
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
assert.ok(hit?.original, "production stack must map to obs-probe.ts");
assert.equal(hit.original.line, 2);
assert.equal(symbolicated.tags.release, "reactor@0.3.4+91fef7d10b02370b");
assert.equal(symbolicated.tags.reactorEnv, "LOCAL");
assert.equal(symbolicated.tags.chainId, 5042002);
assert.equal(symbolicated.tags.chainName, "REACTOR local (Arc-compatible)");
assert.equal(symbolicated.tags.buildSha, "91fef7d10b02370b");
assert.equal(symbolicated.tags.buildTimestamp, "2026-09-12T20:18:00.000Z");

{
  resetTelemetryForTests();
  const seen: Array<ReturnType<typeof reportFailure>> = [];
  const stop = addTelemetrySink((e) => {
    seen.push(e);
  });
  const ev = reportFailure("ui", thrown, {
    route: "/trade",
    resolvedFrames: symbolicated.frames.map((f) => ({
      fn: f.generated.functionName,
      generated: `${basenameSafe(f.generated.file)}:${f.generated.line}:${f.generated.column}`,
      original: f.original ? `${f.original.source}:${f.original.line}:${f.original.column}` : null,
    })),
    symbolicated: true,
  });
  stop();
  assert.equal(seen.length, 1);
  assert.equal(ev.release, "reactor@0.3.4+91fef7d10b02370b");
  assert.equal(ev.buildSha, "91fef7d10b02370b");
  assert.equal(ev.reactorEnv, "LOCAL");
  assert.equal(ev.chainId, 5042002);
  assert.equal(ev.chainName, "REACTOR local (Arc-compatible)");
  assert.equal(ev.buildTimestamp, "2026-09-12T20:18:00.000Z");
  assert.equal(ev.extra?.symbolicated, true);
  assert.match(JSON.stringify(ev.extra?.resolvedFrames), /obs-probe\.ts:2:/);

  const sentry = toSentryStorePayload(ev);
  const sentryTags = sentry.tags as Record<string, string>;
  assert.equal(sentry.release, ev.release);
  assert.equal(sentryTags.build_sha, "91fef7d10b02370b");
  assert.equal(sentryTags.reactor_env, "LOCAL");
  assert.equal(sentryTags.chain_id, "5042002");
  assert.equal(sentryTags.chain_name, "REACTOR local (Arc-compatible)");
  assert.equal(sentryTags.build_time, "2026-09-12T20:18:00.000Z");
}

{
  const skip = planSourcemapUpload({ mapDirExists: false });
  assert.equal(skip.ok, true);
  assert.equal(skip.sentry, "skip");
  assert.equal(skip.archive, false);

  const requiredMissing = planSourcemapUpload({ mapDirExists: false, requireMaps: true });
  assert.equal(requiredMissing.ok, false);
  assert.match(requiredMissing.reason, /REACTOR_SOURCEMAPS=1/);

  const archiveOnly = planSourcemapUpload({ mapDirExists: true });
  assert.equal(archiveOnly.ok, true);
  assert.equal(archiveOnly.archive, true);
  assert.equal(archiveOnly.sentry, "skip");

  const sentry = planSourcemapUpload({
    mapDirExists: true,
    sentryToken: "sntrys_test",
    sentryOrg: "reactor",
    sentryProject: "web",
  });
  assert.equal(sentry.sentry, "upload");
  assert.equal(sentry.archive, true);
  assert.equal(sentry.ok, true);
}

function basenameSafe(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

console.log("obs/sourcemap tests ok");
