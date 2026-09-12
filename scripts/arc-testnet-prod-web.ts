#!/usr/bin/env npx tsx
/**
 * Configure / optionally build the production Next app against Arc Public Testnet.
 * Refuses to set claimedArcTestnet unless deployments/arc-testnet.json exists
 * with claimedArcTestnet=true AND an explorer verification URL.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ARC_TESTNET_CHAIN_ID, EXPLORER } from "./arc-testnet-lib.ts";

const root = join(import.meta.dirname, "..");
const examplePath = join(root, "deployments/arc-testnet.env.example");

function loadTestnetClaim(): { claimed: boolean; rpc: string; note: string } {
  const file = join(root, "deployments/arc-testnet.json");
  if (!existsSync(file)) {
    return {
      claimed: false,
      rpc: "https://rpc.testnet.arc.io",
      note: "no deployments/arc-testnet.json — production web points at public RPC but addresses stay local placeholders (banner on).",
    };
  }
  const j = JSON.parse(readFileSync(file, "utf8")) as {
    claimedArcTestnet?: boolean;
    rpc?: string;
    verificationUrl?: string;
  };
  if (j.claimedArcTestnet && !j.verificationUrl) {
    return { claimed: false, rpc: j.rpc ?? "https://rpc.testnet.arc.io", note: "claimedArcTestnet without verificationUrl — refused" };
  }
  return {
    claimed: Boolean(j.claimedArcTestnet && j.verificationUrl),
    rpc: j.rpc ?? "https://rpc.testnet.arc.io",
    note: j.claimedArcTestnet ? "claimed dump present" : "testnet dump exists but claimedArcTestnet is false",
  };
}

const claim = loadTestnetClaim();
const env = `# Production-shaped Next + indexer against Arc Public Testnet (5042002).
# Copy to .env.local / host secrets. Never commit private keys.
# claimedArcTestnet=${claim.claimed} — ${claim.note}

REACTOR_ENV=PROD
NODE_ENV=production
NEXT_PUBLIC_CHAIN_ID=${ARC_TESTNET_CHAIN_ID}
NEXT_PUBLIC_RPC_URL=${claim.rpc}
NEXT_PUBLIC_EXPLORER_URL=${EXPLORER}
NEXT_PUBLIC_INDEXER_URL=http://127.0.0.1:43148
ARC_TESTNET_RPC=${claim.rpc}
ARC_FINALITY_CONFIRMATIONS=0

# Required in PROD (indexer + isolated signer refuse to start without these).
TURNSTILE_SECRET=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
PRICING_SIGNER_PK=
SIGNER_INTERNAL_TOKEN=
ADMISSION_HMAC_SECRET=
# SIGNER_INLINE must stay unset/false in PROD.

# Optional
# NEXT_PUBLIC_WALLETCONNECT_ID=
# DATABASE_URL=postgres://user:pass@host:5432/reactor
# MEDIA_CDN_BASE=
# R2_ENDPOINT=
# R2_BUCKET=
# R2_ACCESS_KEY=
# R2_SECRET_KEY=
`;

writeFileSync(examplePath, env);
writeFileSync(join(root, "apps/web/.env.production.example"), env);
console.log(`wrote ${examplePath}`);
console.log(`wrote apps/web/.env.production.example`);
console.log(JSON.stringify({ claimed: claim.claimed, rpc: claim.rpc, note: claim.note, chainId: ARC_TESTNET_CHAIN_ID }, null, 2));

if (process.argv.includes("--build")) {
  if (!claim.claimed && !process.argv.includes("--allow-unclaimed")) {
    console.error("Refuse production Next build against unclaimed addresses. Pass --allow-unclaimed to compile only.");
    process.exit(2);
  }
  const r = spawnSync("pnpm", ["--filter", "web", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
  process.exit(r.status ?? 1);
}
