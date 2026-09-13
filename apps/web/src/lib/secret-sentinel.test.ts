import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findSecretNeedles, isSentinelSelf, sourceLeakNeedles } from "./secret-sentinel.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, acc);
    } else if (/\.(ts|tsx|js|mjs|cjs|json|env)$/.test(name)) acc.push(p);
  }
  return acc;
}

const webSrc = join(import.meta.dirname, "..");
const files = walk(webSrc);
assert(files.length > 20, "walked web src");

const needles = sourceLeakNeedles();
for (const file of files) {
  if (isSentinelSelf(file)) continue;
  const text = readFileSync(file, "utf8");
  const hits = findSecretNeedles(text, needles);
  assert(hits.length === 0, `${file} must not embed ${hits.join(", ")}`);
}

const envExample = readFileSync(join(import.meta.dirname, "../../../../.env.example"), "utf8");
for (const name of [
  "NEXT_PUBLIC_KEEPER_PRIVATE_KEY",
  "NEXT_PUBLIC_PRICING_SIGNER_PK",
  "NEXT_PUBLIC_TURNSTILE_SECRET",
  "NEXT_PUBLIC_ADMISSION_HMAC_SECRET",
  "NEXT_PUBLIC_R2_SECRET_KEY",
  "NEXT_PUBLIC_DEPLOYER_PK",
  "NEXT_PUBLIC_ARC_TESTNET_PK",
  "NEXT_PUBLIC_GEO_EDGE_SECRET",
]) {
  assert(!envExample.includes(name), `.env.example must not publicize ${name}`);
}
assert(envExample.includes("KEEPER_PRIVATE_KEY"), "server keeper key stays server-only in example");
assert(envExample.includes("PRICING_SIGNER_PK"), "signer pk stays server-only");
assert(envExample.includes("# Never set PRICING_SIGNER_PK in the Next process"), "signer isolation comment");

console.log("secret-sentinel source tests ok");
