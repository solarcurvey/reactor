#!/usr/bin/env npx tsx
/**
 * Non-interactive dual-relayer failover rehearsal against local forge.
 * Runs MaintenanceFailover.t.sol (real consume + Replay), then checks recorded evidence.
 * Also asserts CRE / typed calldata identity. Does not sign-and-write a fake rehearsal.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import {
  ACTION_SETTLE_QUOTE,
  encodeSettleCall,
  hashHops,
  makeJob,
  maintenanceDomain,
  MAINTENANCE_JOB_TYPES,
  settlePayload,
  jobIdFromOp,
} from "../packages/reactor/src/maintenance-job.ts";
import { creReport, relayCalldata } from "../ops/cre/workflow.ts";

const ROOT = join(import.meta.dirname, "..");
const EVIDENCE = join(ROOT, "ops/cre/simulation/failover-rehearsal.json");
const IDENTITY = join(ROOT, "ops/cre/simulation/failover-calldata-identity.json");
const CONTRACTS = join(ROOT, "contracts");

function forgeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const foundryBin = join(process.env.HOME ?? "", ".foundry/bin");
  if (existsSync(foundryBin)) env.PATH = `${foundryBin}:${env.PATH ?? ""}`;
  return env;
}

function forgeBin(): string {
  const home = process.env.HOME ?? "";
  const candidates = [process.env.FORGE_BIN, join(home, ".foundry/bin/forge"), "forge"].filter(
    (x): x is string => Boolean(x),
  );
  for (const c of candidates) {
    if (c !== "forge" && !existsSync(c)) continue;
    const probe = spawnSync(c, ["--version"], { encoding: "utf8", env: forgeEnv() });
    if (probe.status === 0) return c;
  }
  return "";
}

function runForgeRehearsal(forge: string): string {
  const r = spawnSync(
    forge,
    ["test", "--match-contract", "MaintenanceFailover", "--match-test", "test_dualRelayerFirstValidConsumeSecondReplayNoOp", "-vv"],
    { cwd: CONTRACTS, encoding: "utf8", env: forgeEnv() },
  );
  const out = `${r.error?.message ?? ""}\n${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (r.error || r.status !== 0) {
    throw new Error(`local-forge MaintenanceFailover failed (status ${r.status}):\n${out}`);
  }
  if (!/test_dualRelayerFirstValidConsumeSecondReplayNoOp/.test(out) && !/Suite result: ok/.test(out) && !/PASS/.test(out)) {
    throw new Error(`forge ran but did not report the failover test:\n${out}`);
  }
  return out;
}

function assertEvidence(raw: string): Record<string, unknown> {
  const ev = JSON.parse(raw) as Record<string, unknown>;
  const need = {
    kind: "local-forge-execution",
    relayerAResult: "first valid consume - settleQuote executed",
    relayerBResult: "Replay - harmless no-op, pot unchanged",
  };
  for (const [k, v] of Object.entries(need)) {
    if (ev[k] !== v) throw new Error(`evidence ${k}=${JSON.stringify(ev[k])} expected ${JSON.stringify(v)}`);
  }
  if (ev.potUnchangedBySecond !== true) throw new Error("evidence potUnchangedBySecond must be true");
  if (ev.usedJobAfterFirst !== true || ev.usedJobAfterSecond !== true) {
    throw new Error("evidence usedJob flags must be true after both submits");
  }
  const potA = BigInt(String(ev.potAfterRelayerA ?? "0"));
  const potB = BigInt(String(ev.potAfterRelayerB ?? "1"));
  if (potA === 0n || potA !== potB) throw new Error("evidence pot after A/B must match and be nonzero");
  if (String(ev.environment ?? "").includes("5042") === false) {
    throw new Error("evidence must explicitly exclude Arc Mainnet 5042");
  }
  if (!String(ev.proof ?? "").includes("MaintenanceFailover.t.sol")) {
    throw new Error("evidence must cite MaintenanceFailover.t.sol (encode-only JSON is not a rehearsal)");
  }
  return ev;
}

async function assertCalldataIdentity() {
  const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
  const gateway = "0x0000000000000000000000000000000000000011" as const;
  const usdc = "0x0000000000000000000000000000000000000012" as const;
  const chainId = 5042002n;
  const account = privateKeyToAccount(ANVIL0);
  const hops = [] as const;
  const hopsH = hashHops([...hops]);
  const amount = 10_000_000n;
  const minOut = 10_000_000n;
  const nowSec = 1_700_000_000n;
  const job = makeJob({
    gateway,
    chainId,
    action: ACTION_SETTLE_QUOTE,
    payloadHash: settlePayload(usdc, amount, minOut, hopsH),
    jobId: jobIdFromOp("settle:usdc:10000000"),
    nowSec,
    snapshotHash: hopsH,
  });
  const signature = await account.signTypedData({
    domain: maintenanceDomain(chainId, gateway),
    types: MAINTENANCE_JOB_TYPES,
    primaryType: "MaintenanceJob",
    message: job,
  });
  const env = { job, signature, kind: "settleQuote" as const, quote: usdc, amount, minOut, hops: [...hops] };
  const relayerA = relayCalldata(env);
  const relayerB = relayCalldata(env);
  const typed = encodeSettleCall(job, signature, usdc, amount, [...hops], minOut);
  if (relayerA !== relayerB || relayerA !== typed) throw new Error("identical job must encode identically");
  const weakened = encodeSettleCall(job, signature, usdc, amount, [...hops], 1n);
  if (weakened === relayerA) throw new Error("weak minOut must change calldata (and fail payload check onchain)");
  return {
    interface: "MaintenanceJob EIP-712 calldata identity (not an execution proof)",
    jobId: job.jobId,
    identicalRelayers: relayerA === relayerB,
    calldataHash: keccak256(toBytes(relayerA)),
    creOnReportHash: keccak256(creReport(env)),
    note: "Same encode path as ops/cre/workflow.ts. This file is local-forge + calldata identity, not official cre workflow simulate. See cre-workflow-simulate.json.",
  };
}

async function main() {
  const forge = forgeBin();
  if (!forge) {
    throw new Error(
      "forge is required to re-execute MaintenanceFailover.t.sol (CI full/main solidity + size-guard). Do not run this from the indexer unit suite.",
    );
  }
  const forgeLog = runForgeRehearsal(forge);
  if (!existsSync(EVIDENCE)) {
    throw new Error(`missing ${EVIDENCE} — MaintenanceFailover.t.sol must write it`);
  }
  const evidence = assertEvidence(readFileSync(EVIDENCE, "utf8"));
  const identity = await assertCalldataIdentity();
  mkdirSync(join(ROOT, "ops/cre/simulation"), { recursive: true });
  writeFileSync(IDENTITY, JSON.stringify(identity, null, 2) + "\n");
  writeFileSync(
    join(ROOT, "ops/cre/simulation/arc-testnet-poc.json"),
    JSON.stringify(
      {
        recorded: "2026-09-12",
        kind: "local-forge-execution-plus-job-interface",
        creTrust: "Courier only. Not a Top-10 oracle.",
        networks: {
          localForge: "MaintenanceFailover.t.sol",
          repoLocal: 5042002,
          creArcTestnetEip155: 1883,
          repoArcMainnet: 5042,
          creArcMainnetProductionWrite: "not listed / not used / not claimed",
        },
        executionEvidence: "ops/cre/simulation/failover-rehearsal.json",
        creWorkflowSimulate: "ops/cre/simulation/cre-workflow-simulate.json",
        calldataIdentity: identity,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("maintenance failover rehearsal ok", {
    kind: evidence.kind,
    jobId: evidence.jobId,
    potAfterRelayerA: evidence.potAfterRelayerA,
    potAfterRelayerB: evidence.potAfterRelayerB,
    forgeReexecuted: true,
    forgePassed: /Suite result: ok|PASS/.test(forgeLog),
    calldataIdentity: identity.calldataHash,
  });
}

void main();
