#!/usr/bin/env npx tsx
/**
 * Configure / optionally build the production Next app against Arc Public Testnet.
 * Refuses to set claimedArcTestnet unless deployments/arc-testnet.json exists
 * with claimedArcTestnet=true AND an explorer verification URL.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ARC_TESTNET_CHAIN_ID,
  EXPLORER,
  assembleProdPathReport,
  codeSize,
  nativeBalance,
  rpcCall,
} from "./arc-testnet-lib.ts";
import { productionHardGateFailures } from "../apps/indexer/src/prod-gates.ts";

const root = join(import.meta.dirname, "..");
const examplePath = join(root, "deployments/arc-testnet.env.example");

function loadTestnetClaim(): {
  claimed: boolean;
  rpc: string;
  note: string;
  verificationUrl?: string;
  deployer?: string;
  factory?: string;
  launchSigner?: string;
  keeper?: string;
  pricingSigner?: string;
} {
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
    deployer?: string;
    addresses?: Record<string, string>;
  };
  if (j.claimedArcTestnet && !j.verificationUrl) {
    return { claimed: false, rpc: j.rpc ?? "https://rpc.testnet.arc.io", note: "claimedArcTestnet without verificationUrl — refused" };
  }
  const addrs = j.addresses ?? {};
  return {
    claimed: Boolean(j.claimedArcTestnet && j.verificationUrl),
    rpc: j.rpc ?? "https://rpc.testnet.arc.io",
    note: j.claimedArcTestnet ? "claimed dump present" : "testnet dump exists but claimedArcTestnet is false",
    verificationUrl: j.verificationUrl,
    deployer: j.deployer,
    factory: addrs.ReactorFactory,
    launchSigner: addrs.LaunchSigner ?? addrs.PricingSigner,
    keeper: addrs.Keeper,
    pricingSigner: addrs.PricingSigner,
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

async function main() {
  writeFileSync(examplePath, env);
  writeFileSync(join(root, "apps/web/.env.production.example"), env);
  console.log(`wrote ${examplePath}`);
  console.log(`wrote apps/web/.env.production.example`);

  const eq = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const gateFailures = productionHardGateFailures({ REACTOR_ENV: "PROD", NODE_ENV: "production" } as NodeJS.ProcessEnv);
  let chainId: number | undefined;
  let factoryCodeBytes: number | undefined;
  let deployerBalanceWei: string | undefined;
  try {
    const id = await rpcCall(claim.rpc, "eth_chainId", []);
    if (id.ok) chainId = Number.parseInt(String(id.result), 16);
  } catch {
    /* recorded as missing chainId */
  }
  if (claim.factory) {
    try {
      factoryCodeBytes = await codeSize(claim.rpc, claim.factory as `0x${string}`);
    } catch {
      factoryCodeBytes = 0;
    }
  }
  if (claim.deployer) {
    try {
      deployerBalanceWei = (await nativeBalance(claim.rpc, claim.deployer as `0x${string}`)).toString();
    } catch {
      deployerBalanceWei = undefined;
    }
  }

  let indexerStatus: number | null = null;
  try {
    const indexer = spawnSync("pnpm", ["--filter", "indexer", "dev"], {
      cwd: root,
      encoding: "utf8",
      timeout: 12_000,
      env: {
        ...process.env,
        REACTOR_ENV: "PROD",
        NODE_ENV: "production",
        SIGNER_INLINE: "",
        PRICING_SIGNER_PK: "",
        TURNSTILE_SECRET: "",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
        SIGNER_INTERNAL_TOKEN: "",
        ADMISSION_HMAC_SECRET: "",
      },
    });
    indexerStatus = indexer.status;
  } catch {
    indexerStatus = null;
  }
  const refused = indexerStatus !== 0;
  const gateLine = refused
    ? `PRODUCTION_HARD_GATES: refuse start/launch — ${gateFailures.join("; ")} (indexer exit ${indexerStatus ?? "timeout"})`
    : "indexer started — unexpected for empty PROD secrets";

  const report = assembleProdPathReport({
    claimedDump: claim.claimed,
    verificationUrl: claim.verificationUrl,
    chainId,
    factoryCodeBytes,
    deployerBalanceWei,
    indexerProdStart: { ok: false, detail: gateLine.slice(0, 400) },
    gateFailures,
    launchSignerIsDeployer: eq(claim.launchSigner, claim.deployer) || eq(claim.pricingSigner, claim.deployer),
    keeperIsDeployer: eq(claim.keeper, claim.deployer),
    walletConnectConfigured: Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_ID?.trim()),
  });
  const reportPath = join(root, "deployments/arc-testnet-prod-path.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${reportPath}`);
  console.log(
    JSON.stringify(
      {
        claimed: claim.claimed,
        claimedProdPath: report.claimedProdPath,
        rpc: claim.rpc,
        note: claim.note,
        chainId: chainId ?? ARC_TESTNET_CHAIN_ID,
        blockers: report.blockers,
      },
      null,
      2,
    ),
  );

  if (process.argv.includes("--build")) {
    if (!claim.claimed && !process.argv.includes("--allow-unclaimed")) {
      console.error("Refuse production Next build against unclaimed addresses. Pass --allow-unclaimed to compile only.");
      process.exit(2);
    }
    const r = spawnSync("pnpm", ["--filter", "web", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
    process.exit(r.status ?? 1);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
