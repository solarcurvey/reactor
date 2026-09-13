#!/usr/bin/env npx tsx
/**
 * Archive (and optionally upload) Next.js client maps for the current release SHA.
 * First-party archive is the Sentry-or-equivalent gate — a no-op skip is not enough
 * when REACTOR_SOURCEMAPS_REQUIRE=1.
 * Does not print tokens. Does not deploy mainnet.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planSourcemapUpload } from "../apps/web/src/lib/obs/sourcemap.ts";

const org = process.env.SENTRY_ORG;
const project = process.env.SENTRY_PROJECT;
const token = process.env.SENTRY_AUTH_TOKEN;
const release =
  process.env.NEXT_PUBLIC_RELEASE ||
  `reactor@${process.env.NEXT_PUBLIC_PROTOCOL_VERSION || "0.0.0"}+${process.env.NEXT_PUBLIC_BUILD_SHA || process.env.GITHUB_SHA || "dev"}`;

const mapDir = join(process.cwd(), "apps/web/.next/static");
const plan = planSourcemapUpload({
  mapDirExists: existsSync(mapDir),
  sentryToken: token,
  sentryOrg: org,
  sentryProject: project,
  requireMaps: process.env.REACTOR_SOURCEMAPS_REQUIRE === "1",
});

if (!plan.ok) {
  console.error(plan.reason);
  process.exit(1);
}

if (plan.archive) {
  const dest = join(process.cwd(), "artifacts/sourcemaps", release.replace(/[^A-Za-z0-9@+._-]/g, "_"));
  mkdirSync(dest, { recursive: true });
  cpSync(mapDir, dest, { recursive: true });
  writeFileSync(
    join(dest, "release.json"),
    JSON.stringify(
      {
        release,
        protocolVersion: process.env.NEXT_PUBLIC_PROTOCOL_VERSION || "",
        buildSha: process.env.NEXT_PUBLIC_BUILD_SHA || process.env.GITHUB_SHA || "dev",
        reactorEnv: process.env.NEXT_PUBLIC_REACTOR_ENV || process.env.REACTOR_ENV || "LOCAL",
        chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || "5042002"),
        chainName: process.env.NEXT_PUBLIC_CHAIN_NAME || "REACTOR local (Arc-compatible)",
        buildTimestamp: process.env.NEXT_PUBLIC_BUILD_TIME || "",
      },
      null,
      2,
    ),
  );
  console.log(`archived source maps for ${release} → ${dest}`);
}

if (plan.sentry === "skip") {
  console.log(plan.reason);
  process.exit(0);
}

const cmd = [
  "npx --yes @sentry/cli sourcemaps upload",
  `--org ${org}`,
  `--project ${project}`,
  `--release ${release}`,
  mapDir,
].join(" ");

execSync(cmd, { stdio: "inherit", env: process.env });
console.log(`uploaded source maps for ${release}`);
