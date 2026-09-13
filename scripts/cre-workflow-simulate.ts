#!/usr/bin/env npx tsx
/**
 * Record CRE workflow simulation evidence for a signed MaintenanceJob.
 *
 * Tries official `cre workflow simulate` (local WASM simulator; live DON not
 * required). That CLI requires a CRE login or CRE_API_KEY. This environment
 * usually has neither — the refusal is recorded, not faked.
 *
 * Always runs the same HTTP-trigger courier handler (`handle-signed-job.ts`)
 * against the signed payload so the job interface is exercised and hashed.
 *
 * --write (default): refresh committed evidence.
 * --verify: recompute and require committed JSON/log to match (CI).
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
    if (!existsSync(PAYLOAD) || !existsSync(EVIDENCE) || !existsSync(LOG)) {
      throw new Error("committed CRE simulate artifacts missing — run without --verify to write them");
    }
    const committedPayload = readJson(PAYLOAD) as SignedJobHttpPayload;
    const committedEv = readJson(EVIDENCE) as Record<string, unknown>;
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
    const committedOfficial = committedEv.officialCli as { attempted?: boolean; authBlocked?: boolean; compiled?: boolean };
    if (committedOfficial?.compiled === true) {
      throw new Error("committed evidence must not claim WASM compile unless independently reproduced");
    }
    if (String(committedEv.kind).includes("cre-cli-workflow-simulate") && committedOfficial?.compiled !== true) {
      throw new Error("kind claims official simulate success but compiled is not true");
    }
    if (official.attempted && official.authBlocked !== committedOfficial?.authBlocked) {
      throw new Error("official CLI authBlocked flag drifted from committed evidence");
    }
    if (!existsSync(LOG) || !readFileSync(LOG, "utf8").includes(handler.relayCalldataHash)) {
      throw new Error("cre-workflow-simulate.cli.txt must contain the handler calldata hash");
    }
    console.log("cre workflow simulate verify ok", {
      kind: committedEv.kind,
      jobId: handler.jobId,
      relayCalldataHash: handler.relayCalldataHash,
      officialPresent: official.attempted,
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
