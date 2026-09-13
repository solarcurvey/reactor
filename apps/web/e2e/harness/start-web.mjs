#!/usr/bin/env node
/**
 * Production Next build + start for the #35 E2E release gate and #36 QA gate.
 * NEXT_PUBLIC_* must be present at build time.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDEXER_URL, RPC_URL, WEB_PORT } from "./constants.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(webRoot);

const env = {
  ...process.env,
  NEXT_PUBLIC_REVIEW_FIXTURES: "1",
  NEXT_PUBLIC_QA_INJECT: process.env.NEXT_PUBLIC_QA_INJECT ?? "1",
  REACTOR_TELEMETRY_RELAXED: process.env.REACTOR_TELEMETRY_RELAXED ?? "1",
  NEXT_PUBLIC_INDEXER_URL: INDEXER_URL,
  NEXT_PUBLIC_RPC_URL: RPC_URL,
  // Release gate sets short TTL via playwright.release.config.ts. QA / default stay 30s.
  NEXT_PUBLIC_QUOTE_TTL_MS: process.env.NEXT_PUBLIC_QUOTE_TTL_MS ?? "30000",
  NEXT_PUBLIC_TX_WAIT_MS: process.env.NEXT_PUBLIC_TX_WAIT_MS ?? "60000",
  INDEXER_URL,
  NODE_ENV: "production",
};

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: "inherit", cwd: webRoot });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

if (!process.env.E2E_SKIP_BUILD) {
  console.log("[e2e-web] next build (production, review fixtures + mock URLs)");
  await run("pnpm", ["build"]);
}

console.log(`[e2e-web] next start :${WEB_PORT}`);
await run("pnpm", ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(WEB_PORT)]);
