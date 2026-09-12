#!/usr/bin/env npx tsx
/**
 * Live Arc Public Testnet deploy rehearsal (#16).
 * Records RPC/chain/faucet evidence. Broadcasts only with a funded non-Anvil key.
 * claimed stays false until an explorer hash is confirmed. Mainnet 5042 blocked.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARC_TESTNET_CHAIN_ID,
  CANONICAL_USDC,
  EXPLORER,
  attemptCircleFaucet,
  claimDecision,
  codeSize,
  faucetBlockerSummary,
  isAnvil0Key,
  nativeBalance,
  probeAllRpcs,
  redactSecrets,
  refuseMainnet,
  verifiedChain,
  waitingAddressFromEnv,
  type FaucetAttempt,
  type RpcProbe,
} from "./arc-testnet-lib.ts";

const root = join(import.meta.dirname, "..");
const outJson = join(root, "deployments/arc-testnet-rehearsal.json");
const outMd = join(root, "deployments/arc-testnet-rehearsal.md");

type Report = {
  at: string;
  issue: "https://github.com/solarcurvey/reactor/issues/16";
  claimed: false;
  mainnet: "blocked";
  waitingAddress?: `0x${string}`;
  nativeBalanceWei?: string;
  chain: ReturnType<typeof verifiedChain>;
  rpcProbes: RpcProbe[];
  dependencyCode?: Record<string, { address: string; bytes: number }>;
  faucet: { attempts: FaucetAttempt[]; summary: string };
  deploy: {
    attempted: boolean;
    txHash?: string;
    explorer?: string;
    error?: string;
    note: string;
  };
  webJourney: {
    attempted: boolean;
    note: string;
  };
  blockers: string[];
  nextHumanSteps: string[];
};

function loadWaitingAddress(): `0x${string}` | undefined {
  const env = waitingAddressFromEnv();
  if (env) return env;
  const file = process.env.ARC_TESTNET_ADDRESS_FILE ?? "/tmp/cursor/reactor-testnet/address.txt";
  if (existsSync(file)) {
    const a = readFileSync(file, "utf8").trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(a)) return a as `0x${string}`;
  }
  return undefined;
}

function renderMarkdown(r: Report): string {
  const probes = r.rpcProbes
    .map(
      (p) =>
        `| \`${p.url}\` | ${p.ok ? "live" : "failed"} | ${p.chainId ?? "—"} | ${p.blockNumber ?? "—"} | ${p.httpStatus ?? "—"} | ${p.error ?? "—"} |`,
    )
    .join("\n");
  const faucet = r.faucet.attempts
    .map((a) => `| ${a.method} | \`${a.url}\` | ${a.httpStatus ?? "—"} | ${a.error ?? a.note} |`)
    .join("\n");
  const deps = r.dependencyCode
    ? Object.entries(r.dependencyCode)
        .map(([k, v]) => `| ${k} | \`${v.address}\` | ${v.bytes} |`)
        .join("\n")
    : "| — | — | — |";
  return `# Arc Public Testnet rehearsal — issue #16

**claimed: false.** This file is live evidence from \`${r.at}\`. Do not treat it as a successful Factory deploy.

| Field | Value |
| --- | --- |
| Issue | [#16](https://github.com/solarcurvey/reactor/issues/16) |
| Waiting deployer (public address only) | ${r.waitingAddress ? `\`${r.waitingAddress}\`` : "— (generate with \`cast wallet new\`)"} |
| Native gas (USDC-18) | ${r.nativeBalanceWei ?? "unknown"} wei |
| Verified chain | ${r.chain.ok ? `**${r.chain.chainId}** via \`${r.chain.rpc}\`` : r.chain.note} |
| Factory claimed | **false** |
| Mainnet 5042 | blocked |

## RPC probes

Primary Circle RPCs were called with a browser User-Agent. Some datacenter clients without that header receive Cloudflare **1010**.

| RPC | Status | chainId | head | HTTP | Error |
| --- | --- | --- | --- | --- | --- |
${probes}

${r.chain.note}

## Canonical code on 5042002 (not REACTOR)

| Item | Address | Runtime bytes |
| --- | --- | --- |
${deps}

Uniswap v4 \`PoolManager\` is **not** claimed on Arc Public Testnet. This repo does not invent one.

## Faucet

${r.faucet.summary}

| Attempt | URL | HTTP | Result |
| --- | --- | --- | --- |
${faucet}

Arc docs ([RPC endpoints](https://docs.arc.io/arc/references/rpc-endpoints), [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc)) list only \`https://faucet.circle.com\`. There is no permissionless alternate drip.

## Deploy

${r.deploy.note}

${r.deploy.txHash ? `Broadcast hash: \`${r.deploy.txHash}\` — [explorer](${r.deploy.explorer}). **claimed still false** until a human confirms the receipt.` : "No \`eth_sendRawTransaction\` for Factory/modules."}

## Production web journey

${r.webJourney.note}

## Blockers

${r.blockers.map((b) => `- ${b}`).join("\n")}

## Human unblock (keep #16 open)

${r.nextHumanSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Then re-run:

\`\`\`bash
export ARC_TESTNET_PK=0x…          # never commit
export ARC_TESTNET_ADDRESS=${r.waitingAddress ?? "0x…"}
export ARC_TESTNET_RPC=https://rpc.testnet.arc.io
pnpm arc:rehearsal
pnpm arc:wallet-harness
\`\`\`

See \`scripts/arc-testnet-runbook.md\`.
`;
}

async function maybeBroadcast(report: Report, rpc: string): Promise<void> {
  const pk = process.env.ARC_TESTNET_PK ?? "";
  if (!pk || pk.length < 10) {
    report.deploy = {
      attempted: false,
      note: "ARC_TESTNET_PK unset. No broadcast. Key must be a funded disposable test EOA (cast wallet new), never Anvil #0, never committed.",
    };
    return;
  }
  if (isAnvil0Key(pk)) {
    report.deploy = { attempted: false, note: "Refused Anvil #0 key. Generate a disposable test key." };
    report.blockers.push("ARC_TESTNET_PK was Anvil #0 — refused");
    return;
  }
  const bal = report.nativeBalanceWei ? BigInt(report.nativeBalanceWei) : 0n;
  if (bal === 0n) {
    report.deploy = {
      attempted: false,
      note: "Key present but native gas is 0. Broadcast skipped so we do not burn a doomed nonce. Fund via Circle faucet, then re-run.",
    };
    report.blockers.push("deployer native balance is 0 wei");
    return;
  }
  report.deploy = {
    attempted: false,
    note: "Balance is nonzero. Full stack is `forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_TESTNET_RPC --broadcast --legacy --private-key $ARC_TESTNET_PK` after `pnpm arc:factory-attempt`. This rehearsal does not auto-broadcast the entire constructor graph; it refuses to invent hashes. Run the runbook while funded.",
  };
  void rpc;
}

async function main() {
  mkdirSync(join(root, "deployments"), { recursive: true });
  const waitingAddress = loadWaitingAddress();
  const rpcProbes = await probeAllRpcs();
  const chain = verifiedChain(rpcProbes);
  if (chain.chainId) refuseMainnet(chain.chainId);

  const report: Report = {
    at: new Date().toISOString(),
    issue: "https://github.com/solarcurvey/reactor/issues/16",
    claimed: false,
    mainnet: "blocked",
    waitingAddress,
    chain,
    rpcProbes,
    faucet: { attempts: [], summary: "not attempted" },
    deploy: { attempted: false, note: "pending" },
    webJourney: {
      attempted: false,
      note: "Instant + BUY/SELL harness requires a claimed Factory + funded trader. See `pnpm arc:wallet-harness`. Not claimed this run.",
    },
    blockers: [],
    nextHumanSteps: [],
  };

  const liveRpc = chain.rpc ?? "https://rpc.blockdaemon.testnet.arc.io";
  if (chain.ok && waitingAddress) {
    try {
      const bal = await nativeBalance(liveRpc, waitingAddress);
      report.nativeBalanceWei = bal.toString();
    } catch (e) {
      report.blockers.push(`eth_getBalance failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      report.dependencyCode = {
        "USDC ERC-20 (6 decimals, usdPegOne)": {
          address: CANONICAL_USDC,
          bytes: await codeSize(liveRpc, CANONICAL_USDC),
        },
        "CREATE2 (Arachnid)": {
          address: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
          bytes: await codeSize(liveRpc, "0x4e59b44847b379578588920cA78FbF26c0B4956C"),
        },
        Permit2: {
          address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          bytes: await codeSize(liveRpc, "0x000000000022D473030F116dDEE9F6B43aC78BA3"),
        },
        "CCA factory v2.1.0": {
          address: "0x000000001F26a0044BaA66024e7b6599c61963F8",
          bytes: await codeSize(liveRpc, "0x000000001F26a0044BaA66024e7b6599c61963F8"),
        },
      };
    } catch (e) {
      report.blockers.push(`dependency code probe failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!chain.ok) {
    report.blockers.push(chain.note);
  }

  if (waitingAddress) {
    report.faucet.attempts = await attemptCircleFaucet(waitingAddress);
    report.faucet.summary = faucetBlockerSummary(report.faucet.attempts);
    report.blockers.push(report.faucet.summary);
  } else {
    report.blockers.push("no waiting address — run `cast wallet new` and set ARC_TESTNET_ADDRESS");
  }

  await maybeBroadcast(report, liveRpc);

  const claim = claimDecision({
    chainId: chain.chainId ?? 0,
    txHash: report.deploy.txHash,
    explorerConfirmed: false,
  });
  if (claim.claimed) {
    throw new Error("rehearsal must not auto-claim; explorer confirmation is a human step");
  }

  report.nextHumanSteps = [
    `Open ${"https://faucet.circle.com"} — network **Arc**, token **USDC**, address \`${waitingAddress ?? "0x…"}\`. Complete the Google reCAPTCHA (v3 / v2 checkbox).`,
    "Confirm native gas: `cast balance $ADDR --rpc-url https://rpc.testnet.arc.io` is > 0.",
    "Export `ARC_TESTNET_PK` (never commit) and re-run `pnpm arc:rehearsal` then the runbook deploy steps.",
    "Record real addresses + tx hashes in `deployments/arc-testnet.json` and point `deployments/registry.json` at that file. `claimed` stays false until the explorer receipt is confirmed.",
    "Configure production Next (`deployments/arc-testnet.env.example`) and run `pnpm arc:wallet-harness`.",
    `Keep [#16](https://github.com/solarcurvey/reactor/issues/16) open until Instant launch + BUY/SELL land on ${EXPLORER}.`,
  ];

  const safe = redactSecrets(report);
  writeFileSync(outJson, JSON.stringify(safe, null, 2) + "\n");
  writeFileSync(outMd, renderMarkdown(report));
  console.log(JSON.stringify(safe, null, 2));
  console.log(`\nwrote ${outJson}\nwrote ${outMd}`);
  if (report.blockers.length) process.exitCode = 2;
}

void main();
