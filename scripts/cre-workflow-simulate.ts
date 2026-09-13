#!/usr/bin/env npx tsx
/**
 * Record / pin-verify CRE *evidence* for a signed MaintenanceJob.
 *
 * Public CI `--verify` does **not** run a secret-bearing `cre workflow simulate`.
 * It pin-checks committed courier hashes plus `cre-tenant-blocker.json`.
 * A green CI step is not a successful Chainlink CRE simulation.
 *
 * --write (default): refresh committed evidence (may try official CLI locally).
 * --verify: pin-check committed JSON/log + tenant-blocker (CI / test:lib).
 *
 * Future success path (do not invent): if `cre-tenant-blocker.json` is later
 * committed with `closed:true`, `--verify` pin-checks that the committed
 * `cre-workflow-simulate.json` has `compiled=true` and
 * `workflowSimulationResult=true`. Public CI still does not hold CRE_API_KEY.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  ACTION_SETTLE_QUOTE,
  hashHops,
  jobIdFromOp,
  makeJob,
  maintenanceDomain,
  MAINTENANCE_JOB_TYPES,
  settlePayload,
} from "../packages/reactor/src/maintenance-job.ts";
import { handleSignedJobPayload, type SignedJobHttpPayload } from "../ops/cre/maintenance-courier/handle-signed-job.ts";

const ROOT = join(import.meta.dirname, "..");
const SIM = join(ROOT, "ops/cre/simulation");
const PAYLOAD = join(SIM, "signed-job-http-payload.json");
const EVIDENCE = join(SIM, "cre-workflow-simulate.json");
const LOG = join(SIM, "cre-workflow-simulate.cli.txt");
const BUILD_EVIDENCE = join(SIM, "cre-workflow-build.json");
const BUILD_LOG = join(SIM, "cre-workflow-build.cli.txt");
const BLOCKER = join(SIM, "cre-tenant-blocker.json");
const CRE_PROJECT = join(ROOT, "ops/cre");

/** Anvil #0 — simulation signer only. Not a claimed 1883 / 5042 key. */
const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
/** Simulation-only placeholder. Not a claimed Arc Testnet AutomationGateway. */
const PLACEHOLDER_GATEWAY = "0xCEC0000000000000000000000000000000001883" as const;
const USDC = "0x0000000000000000000000000000000000000012" as const;
const CRE_CATALOG_CHAIN_ID = 1883n;
const NOW_SEC = 1_800_000_000n;
const AMOUNT = 10_000_000n;
const MIN_OUT = 10_000_000n;

function findCre(): string {
  const home = process.env.HOME ?? "";
  const candidates = [process.env.CRE_BIN, join(home, ".local/bin/cre"), "cre"].filter(
    (x): x is string => Boolean(x),
  );
  for (const c of candidates) {
    if (c !== "cre" && !existsSync(c)) continue;
    const probe = spawnSync(c, ["version"], { encoding: "utf8" });
    if (probe.status === 0) return c;
  }
  return "";
}

async function signedPayload(): Promise<SignedJobHttpPayload> {
  const hops = [] as const;
  const hopsH = hashHops([...hops]);
  const job = makeJob({
    gateway: PLACEHOLDER_GATEWAY,
    chainId: CRE_CATALOG_CHAIN_ID,
    action: ACTION_SETTLE_QUOTE,
    payloadHash: settlePayload(USDC, AMOUNT, MIN_OUT, hopsH),
    jobId: jobIdFromOp("cre-sim:settle:usdc:10000000:1883"),
    nowSec: NOW_SEC,
    snapshotHash: hopsH,
  });
  const account = privateKeyToAccount(ANVIL0);
  const signature = await account.signTypedData({
    domain: maintenanceDomain(CRE_CATALOG_CHAIN_ID, PLACEHOLDER_GATEWAY),
    types: MAINTENANCE_JOB_TYPES,
    primaryType: "MaintenanceJob",
    message: job,
  });
  return {
    job: {
      gateway: job.gateway,
      chainId: job.chainId.toString(),
      action: job.action,
      payloadHash: job.payloadHash,
      jobId: job.jobId,
      validAfter: job.validAfter.toString(),
      deadline: job.deadline.toString(),
      snapshotHash: job.snapshotHash,
    },
    signature,
    kind: "settleQuote",
    hops: [],
    quote: USDC,
    amount: AMOUNT.toString(),
    minOut: MIN_OUT.toString(),
  };
}

function tryOfficialSimulate(cre: string, payloadPath: string): {
  attempted: true;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  compiled: boolean;
  workflowSimulationResult: boolean;
  authBlocked: boolean;
  creVersion: string;
} {
  const version = spawnSync(cre, ["version"], { encoding: "utf8" });
  const creVersion = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
  const args = [
    "workflow",
    "simulate",
    "maintenance-courier",
    "--target",
    "staging-settings",
    "--non-interactive",
    "--trigger-index",
    "0",
    "--http-payload",
    `@${payloadPath}`,
    "--project-root",
    ".",
  ];
  const r = spawnSync(cre, args, {
    encoding: "utf8",
    cwd: CRE_PROJECT,
    env: {
      ...process.env,
      CRE_ETH_PRIVATE_KEY: ANVIL0.slice(2),
    },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  const combined = `${stdout}\n${stderr}`;
  return {
    attempted: true,
    command: `cre ${args.join(" ")}`,
    exitCode: r.status,
    stdout,
    stderr,
    compiled: /Workflow compiled/i.test(combined),
    workflowSimulationResult: /Workflow Simulation Result/i.test(combined),
    authBlocked: /not logged in|Authentication required|CRE_API_KEY/i.test(combined),
    creVersion,
  };
}

function renderLog(parts: {
  official: ReturnType<typeof tryOfficialSimulate> | { attempted: false; reason: string };
  handler: ReturnType<typeof handleSignedJobPayload>;
}): string {
  const lines = [
    "REACTOR CRE workflow simulation log",
    `recordedAt=2026-09-13`,
    `handler.jobId=${parts.handler.jobId}`,
    `handler.relayCalldataHash=${parts.handler.relayCalldataHash}`,
    `handler.creOnReportHash=${parts.handler.creOnReportHash}`,
    `handler.broadcast=${parts.handler.broadcast}`,
    "",
  ];
  if (!parts.official.attempted) {
    lines.push("official cre workflow simulate: not attempted");
    lines.push(`reason=${"reason" in parts.official ? parts.official.reason : ""}`);
  } else {
    lines.push(`creVersion=${parts.official.creVersion}`);
    lines.push(`command=${parts.official.command}`);
    lines.push(`exitCode=${parts.official.exitCode}`);
    lines.push(`authBlocked=${parts.official.authBlocked}`);
    lines.push(`compiled=${parts.official.compiled}`);
    lines.push(`workflowSimulationResult=${parts.official.workflowSimulationResult}`);
    lines.push("");
    lines.push("--- official CLI stdout ---");
    lines.push(parts.official.stdout.trimEnd() || "(empty)");
    lines.push("");
    lines.push("--- official CLI stderr ---");
    lines.push(parts.official.stderr.trimEnd() || "(empty)");
  }
  lines.push("");
  lines.push("--- HTTP-trigger handler result ---");
  lines.push(JSON.stringify(parts.handler, null, 2));
  lines.push("");
  lines.push("honest: live CRE DON on EIP-155 1883 is not claimed.");
  lines.push("honest: Arc Mainnet 5042 CRE production-write is not listed / not used / not claimed.");
  lines.push("honest: repo-local Anvil / Arc Public Testnet demo is 5042002, not CRE catalog 1883.");
  return lines.join("\n") + "\n";
}

function stableEvidence(
  payload: SignedJobHttpPayload,
  handler: ReturnType<typeof handleSignedJobPayload>,
  official: ReturnType<typeof tryOfficialSimulate> | { attempted: false; reason: string },
) {
  return {
    recorded: "2026-09-13",
    kind: official.attempted && official.compiled && official.workflowSimulationResult
      ? "cre-cli-workflow-simulate"
      : official.attempted && official.authBlocked
        ? "cre-cli-simulate-auth-blocked-plus-signed-job-handler"
        : official.attempted
          ? "cre-cli-simulate-failed-plus-signed-job-handler"
          : "signed-job-handler-cre-cli-unavailable",
    creTrust: "Courier only. Not a Top-10 oracle. Not a live DON. Not Arc Mainnet.",
    networks: {
      creCatalogName: "arc-testnet",
      creArcTestnetEip155: 1883,
      repoLocal: 5042002,
      repoArcMainnet: 5042,
      creArcMainnetProductionWrite: "not listed / not used / not claimed",
      jobChainId: payload.job.chainId,
      gateway: payload.job.gateway,
      gatewayClaim: "simulation-only placeholder — not a claimed 1883 AutomationGateway",
    },
    officialCli: official.attempted
      ? {
          attempted: true,
          creVersion: official.creVersion,
          command: official.command,
          exitCode: official.exitCode,
          authBlocked: official.authBlocked,
          compiled: official.compiled,
          workflowSimulationResult: official.workflowSimulationResult,
          liveDon: false,
          broadcast: false,
        }
      : { attempted: false, reason: official.reason, liveDon: false, broadcast: false },
    signedJob: {
      interface: "MaintenanceJob EIP-712",
      domain: "REACTOR.AutomationGateway / 1 / chainId / gateway",
      action: payload.job.action,
      actionName: "settleQuote",
      jobId: payload.job.jobId,
      validAfter: payload.job.validAfter,
      deadline: payload.job.deadline,
      signedWindowSec: (BigInt(payload.job.deadline) - BigInt(payload.job.validAfter)).toString(),
      payloadHash: payload.job.payloadHash,
    },
    handler,
    payloadPath: "ops/cre/simulation/signed-job-http-payload.json",
    logPath: "ops/cre/simulation/cre-workflow-simulate.cli.txt",
    note: "Official `cre workflow simulate` is the Chainlink local WASM simulator. Live DON is not required and is not claimed. This file records the CLI attempt plus the same signed-job HTTP handler the workflow runs.",
  };
}

function assertHandler(handler: ReturnType<typeof handleSignedJobPayload>, payload: SignedJobHttpPayload) {
  if (handler.action !== ACTION_SETTLE_QUOTE) throw new Error("handler action must be settleQuote (1)");
  if (handler.jobId !== payload.job.jobId) throw new Error("handler must echo the signed jobId");
  if (handler.jobChainId !== "1883") throw new Error("simulation job is CRE catalog 1883, not repo 5042002");
  if (handler.rebuiltMinOut !== false || handler.rebuiltTargets !== false) {
    throw new Error("courier must not rebuild minOut/targets");
  }
  if (handler.broadcast !== false) throw new Error("simulation must not broadcast");
  if (handler.relayCalldataHash === handler.creOnReportHash) {
    throw new Error("typed settleQuote calldata and onReport bytes must differ");
  }
  const window = BigInt(payload.job.deadline) - BigInt(payload.job.validAfter);
  if (window <= 0n || window > 30n * 60n) throw new Error("signed window must be (0, 30m]");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const verify = process.argv.includes("--verify");
  mkdirSync(SIM, { recursive: true });
  const payload = await signedPayload();
  const handler = handleSignedJobPayload(payload);
  assertHandler(handler, payload);
  writeFileSync(PAYLOAD, JSON.stringify(payload, null, 2) + "\n");

  const cre = findCre();
  const official = cre
    ? tryOfficialSimulate(cre, "simulation/signed-job-http-payload.json")
    : { attempted: false as const, reason: "cre CLI binary not found on PATH" };

  const evidence = stableEvidence(payload, handler, official);
  const log = renderLog({ official, handler });

  if (verify) {
    if (!existsSync(PAYLOAD) || !existsSync(EVIDENCE) || !existsSync(LOG) || !existsSync(BLOCKER)) {
      throw new Error("committed CRE evidence / tenant-blocker missing — run without --verify to write them");
    }
    const committedPayload = readJson(PAYLOAD) as SignedJobHttpPayload;
    const committedEv = readJson(EVIDENCE) as Record<string, unknown>;
    const blocker = readJson(BLOCKER) as { closed?: boolean };
    if (JSON.stringify(committedPayload) !== JSON.stringify(payload)) {
      throw new Error("signed-job-http-payload.json drifted from deterministic signer");
    }
    const committedHandler = committedEv.handler as typeof handler;
    if (committedHandler.relayCalldataHash !== handler.relayCalldataHash) {
      throw new Error("committed relayCalldataHash drifted");
    }
    if (committedHandler.creOnReportHash !== handler.creOnReportHash) {
      throw new Error("committed creOnReportHash drifted");
    }
    const committedOfficial = committedEv.officialCli as {
      attempted?: boolean;
      authBlocked?: boolean;
      compiled?: boolean;
      workflowSimulationResult?: boolean;
    };
    if (blocker.closed === true) {
      // Pin-verify a later committed success artifact. Public CI still does
      // not run a secret-bearing tenant simulate.
      if (committedOfficial?.compiled !== true) {
        throw new Error("tenant-blocker closed:true requires committed compiled=true");
      }
      if (committedOfficial?.workflowSimulationResult !== true) {
        throw new Error("tenant-blocker closed:true requires committed Workflow Simulation Result");
      }
      if (committedEv.kind !== "cre-cli-workflow-simulate") {
        throw new Error("tenant-blocker closed:true requires kind cre-cli-workflow-simulate");
      }
    } else {
      if (blocker.closed !== false) {
        throw new Error("cre-tenant-blocker.json must set closed:false until authenticated simulate is committed");
      }
      if (committedOfficial?.compiled === true) {
        throw new Error("blocker still open; committed simulate evidence must not claim compiled=true");
      }
      if (committedOfficial?.workflowSimulationResult === true) {
        throw new Error("blocker still open; committed evidence must not claim a Workflow Simulation Result");
      }
      if (!String(committedEv.kind).includes("auth-blocked")) {
        throw new Error("blocker still open; committed kind must record auth-blocked evidence");
      }
    }
    if (official.attempted && official.authBlocked !== committedOfficial?.authBlocked && blocker.closed !== true) {
      throw new Error("official CLI authBlocked flag drifted from committed evidence");
    }
    if (!existsSync(LOG) || !readFileSync(LOG, "utf8").includes(handler.relayCalldataHash)) {
      throw new Error("cre-workflow-simulate.cli.txt must contain the handler calldata hash");
    }
    if (!existsSync(BUILD_EVIDENCE) || !existsSync(BUILD_LOG)) {
      throw new Error("committed CRE workflow build artifacts missing");
    }
    const committedBuild = readJson(BUILD_EVIDENCE) as {
      kind?: string;
      closesSimulateAc?: boolean;
      officialCli?: { compiled?: boolean; binaryHash?: string; liveDon?: boolean };
      encodeIdentity?: { identical?: boolean; relayCalldataHash?: string; creOnReportHash?: string };
    };
    if (committedBuild.kind !== "cre-cli-workflow-build") {
      throw new Error("cre-workflow-build.json kind must be cre-cli-workflow-build");
    }
    if (committedBuild.closesSimulateAc === true) {
      throw new Error("official WASM compile must not claim to close the simulate AC");
    }
    if (committedBuild.officialCli?.compiled !== true || !committedBuild.officialCli.binaryHash) {
      throw new Error("committed cre workflow build must record compiled=true and a binary hash");
    }
    if (committedBuild.officialCli.liveDon === true) {
      throw new Error("committed build evidence must not claim a live DON");
    }
    if (committedBuild.encodeIdentity?.identical !== true) {
      throw new Error("CRE WASM encode path must match the Node handler hashes");
    }
    if (committedBuild.encodeIdentity.relayCalldataHash !== handler.relayCalldataHash) {
      throw new Error("build encodeIdentity.relayCalldataHash drifted from Node handler");
    }
    if (committedBuild.encodeIdentity.creOnReportHash !== handler.creOnReportHash) {
      throw new Error("build encodeIdentity.creOnReportHash drifted from Node handler");
    }
    const buildLog = readFileSync(BUILD_LOG, "utf8");
    if (!buildLog.includes("Workflow compiled successfully") || !buildLog.includes(committedBuild.officialCli.binaryHash)) {
      throw new Error("cre-workflow-build.cli.txt must contain official compile success and the binary hash");
    }
    if (!buildLog.includes("not cre workflow simulate")) {
      throw new Error("build log must keep the honest simulate distinction");
    }
    console.log("committed CRE evidence / tenant-blocker verify ok", {
      kind: committedEv.kind,
      blockerClosed: blocker.closed,
      jobId: handler.jobId,
      relayCalldataHash: handler.relayCalldataHash,
      officialPresent: official.attempted,
      officialBuildHash: committedBuild.officialCli.binaryHash,
      simulateAcClosed: blocker.closed === true,
      note: "public CI pin-checks committed files; this is not a CRE simulate PoC",
    });
    return;
  }

  writeFileSync(PAYLOAD, JSON.stringify(payload, null, 2) + "\n");
  writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
  writeFileSync(LOG, log);
  console.log("cre workflow simulate recorded", {
    kind: evidence.kind,
    jobId: handler.jobId,
    relayCalldataHash: handler.relayCalldataHash,
    officialAttempted: official.attempted,
    officialAuthBlocked: official.attempted ? official.authBlocked : undefined,
    officialCompiled: official.attempted ? official.compiled : undefined,
  });
}

void main();
