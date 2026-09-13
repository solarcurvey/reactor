#!/usr/bin/env npx tsx
/**
 * Non-interactive production-shaped dual-relayer failover against a **deployed** AutomationGateway.
 *
 * Roles (separate processes / keys — no human or AI click):
 *   1. Canonical signer service produces + EIP-712-signs MaintenanceJobs (never broadcasts).
 *   2. Failover liveness: A and B start together. A’s submit RPC is down (fails before consume).
 *      B still consumes the same signed job — B does not wait for A=`consumed`.
 *   3. Race idempotency: both submit together; exactly one JobConsumed, the other is Replay.
 *
 * Default: local Anvil 5042002 + `Deploy.s.sol` (real Gateway). Not a claimed Arc Public Testnet
 * address dump. Not Arc Mainnet 5042. Not a live CRE DON. Foundry `vm.prank` is not this path.
 *
 * Optional: GATEWAY_RPC + AUTONOMOUS_RELAY_DEPLOY (already-deployed Gateway JSON) + funded keys.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { AddressInfo } from "node:net";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  slice,
  toBytes,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import {
  ACTION_SETTLE_QUOTE,
  encodeSettleCall,
  hashHops,
  jobIdFromOp,
  makeJob,
  maintenanceDomain,
  MAINTENANCE_JOB_TYPES,
  settlePayload,
} from "../packages/reactor/src/maintenance-job.ts";
import { relayCalldata } from "../ops/cre/workflow.ts";

const ROOT = join(import.meta.dirname, "..");
const SELF = fileURLToPath(import.meta.url);
const TSX = join(ROOT, "node_modules/.bin/tsx");

function spawnSelf(role: string, extraEnv: NodeJS.ProcessEnv): ChildProcess {
  const cmd = existsSync(TSX) ? TSX : "npx";
  const args = existsSync(TSX) ? [SELF, role] : ["--yes", "tsx", SELF, role];
  return spawn(cmd, args, { env: { ...process.env, ...extraEnv }, stdio: "inherit" });
}
const EVIDENCE = join(ROOT, "ops/cre/simulation/autonomous-relay-failover.json");
const DEPLOY_SNAP = join(ROOT, "ops/cre/simulation/autonomous-relay-deploy.json");
const MAINNET = 5042;
const LOCAL_CHAIN = 5042002;
const REPLAY_SEL = slice(keccak256(toBytes("Replay()")), 0, 4);
const JOB_CONSUMED = keccak256(toBytes("JobConsumed(bytes32,uint8,address,bytes32)"));

const ANVIL = {
  deployer: {
    pk: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
    addr: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const,
  },
  signer: {
    pk: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
    addr: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const,
  },
  relayerA: {
    pk: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
    addr: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const,
  },
  relayerB: {
    pk: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex,
    addr: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as const,
  },
};

const flywheelAbi = parseAbi([
  "function accrue(address quote, uint256 amount)",
  "function settleTake(address quote) view returns (uint256)",
  "function usdcPot() view returns (uint256)",
]);
const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const guardianAbi = parseAbi(["function keeper() view returns (address)"]);
const gatewayViewAbi = parseAbi([
  "function jobSigner() view returns (address)",
  "function usedJob(bytes32) view returns (bool)",
]);

type Envelope = {
  job: ReturnType<typeof makeJob>;
  signature: Hex;
  kind: "settleQuote";
  quote: `0x${string}`;
  amount: bigint;
  minOut: bigint;
  hops: [];
};

type Deployed = {
  chainId: number;
  rpc: string;
  claimedArcTestnet: boolean;
  addresses: {
    AutomationGateway: `0x${string}`;
    JobSigner: `0x${string}`;
    USDC: `0x${string}`;
    FlywheelVault: `0x${string}`;
    ReactorHook: `0x${string}`;
    Guardian: `0x${string}`;
  };
};

function foundryBin(name: "anvil" | "forge"): string {
  const home = process.env.HOME ?? "";
  const candidates = [process.env[`${name.toUpperCase()}_BIN`], join(home, ".foundry/bin", name), name].filter(
    (x): x is string => Boolean(x),
  );
  for (const c of candidates) {
    if (c !== name && !existsSync(c)) continue;
    const probe = spawnSync(c, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return c;
  }
  return "";
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serializeEnvelope(env: Envelope) {
  return {
    job: {
      ...env.job,
      chainId: env.job.chainId.toString(),
      validAfter: env.job.validAfter.toString(),
      deadline: env.job.deadline.toString(),
    },
    signature: env.signature,
    kind: env.kind,
    quote: env.quote,
    amount: env.amount.toString(),
    minOut: env.minOut.toString(),
    hops: env.hops,
  };
}

function parseEnvelope(raw: unknown): Envelope {
  const o = raw as Record<string, unknown>;
  const job = o.job as Record<string, string>;
  return {
    job: {
      gateway: job.gateway as `0x${string}`,
      chainId: BigInt(job.chainId),
      action: Number(job.action),
      payloadHash: job.payloadHash as Hex,
      jobId: job.jobId as Hex,
      validAfter: BigInt(job.validAfter),
      deadline: BigInt(job.deadline),
      snapshotHash: job.snapshotHash as Hex,
    },
    signature: o.signature as Hex,
    kind: "settleQuote",
    quote: o.quote as `0x${string}`,
    amount: BigInt(String(o.amount)),
    minOut: BigInt(String(o.minOut)),
    hops: [],
  };
}

function chainOf(id: number, rpc: string) {
  if (id === MAINNET) throw new Error("Arc Mainnet 5042 is hard-disabled");
  return defineChain({
    id,
    name: "reactor-autonomous-relay",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

async function runSigner() {
  const rpc = mustEnv("GATEWAY_RPC");
  const gateway = mustEnv("GATEWAY") as `0x${string}`;
  const usdc = mustEnv("USDC") as `0x${string}`;
  const flywheel = mustEnv("FLYWHEEL") as `0x${string}`;
  const pk = mustEnv("JOB_SIGNER_PRIVATE_KEY") as Hex;
  if (process.env.RELAYER_PRIVATE_KEY) throw new Error("signer process must not hold a relayer key");
  const account = privateKeyToAccount(pk);
  const client = createPublicClient({ transport: http(rpc) });
  const chainId = await client.getChainId();
  if (chainId === MAINNET) throw new Error("5042 disabled");
  let envelope: Envelope | undefined;

  async function produce(): Promise<Envelope> {
    const amount = await client.readContract({
      address: flywheel,
      abi: flywheelAbi,
      functionName: "settleTake",
      args: [usdc],
    });
    if (amount === 0n) throw new Error("settleTake is 0 — seed flywheel before signing");
    const hopsH = hashHops([]);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const job = makeJob({
      gateway,
      chainId: BigInt(chainId),
      action: ACTION_SETTLE_QUOTE,
      payloadHash: settlePayload(usdc, amount, amount, hopsH),
      jobId: jobIdFromOp(`autonomous-relay-settle:${nowSec}:${amount}`),
      nowSec,
      snapshotHash: hopsH,
    });
    const signature = await account.signTypedData({
      domain: maintenanceDomain(BigInt(chainId), gateway),
      types: MAINTENANCE_JOB_TYPES,
      primaryType: "MaintenanceJob",
      message: job,
    });
    envelope = { job, signature, kind: "settleQuote", quote: usdc, amount, minOut: amount, hops: [] };
    return envelope;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true, signer: account.address, hasJob: Boolean(envelope) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/produce") {
        json(res, 200, serializeEnvelope(await produce()));
        return;
      }
      if (req.method === "GET" && url.pathname === "/job") {
        if (!envelope) {
          json(res, 404, { error: "no job" });
          return;
        }
        json(res, 200, serializeEnvelope(envelope));
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  await new Promise<void>((resolve) => server.listen(Number(process.env.SIGNER_PORT ?? 0), "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  writeFileSync(mustEnv("SIGNER_PORT_FILE"), String(port));
  console.log(JSON.stringify({ role: "signer", port, signer: account.address }));
}

async function runRelayer() {
  const rpc = mustEnv("GATEWAY_RPC");
  const pk = mustEnv("RELAYER_PRIVATE_KEY") as Hex;
  if (process.env.JOB_SIGNER_PRIVATE_KEY) throw new Error("relayer process must not hold the job signer key");
  const jobUrl = mustEnv("JOB_URL");
  const label = process.env.RELAYER_LABEL ?? "relayer";
  const account = privateKeyToAccount(pk);
  const client = createPublicClient({ transport: http(rpc) });
  const chainId = await client.getChainId();
  if (chainId === MAINNET) throw new Error("5042 disabled");
  const chain = chainOf(chainId, rpc);
  const submitRpc = process.env.SUBMIT_RPC ?? rpc;
  const submitTimeoutMs = Number(process.env.SUBMIT_TIMEOUT_MS ?? 2000);
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(submitRpc, { timeout: submitTimeoutMs }),
  });
  const fetched = await fetch(jobUrl);
  if (!fetched.ok) throw new Error(`job fetch ${fetched.status}`);
  const env = parseEnvelope(await fetched.json());
  const data = relayCalldata(env);
  const typed = encodeSettleCall(env.job, env.signature, env.quote, env.amount, env.hops, env.minOut);
  if (data !== typed) throw new Error("relayer calldata drifted from signed envelope");

  const mode = process.env.RELAYER_MODE ?? "submit";
  if (mode === "fail-before-send") {
    const pot = await client.readContract({
      address: mustEnv("FLYWHEEL") as `0x${string}`,
      abi: flywheelAbi,
      functionName: "usdcPot",
    });
    const usedJob = await client.readContract({
      address: env.job.gateway,
      abi: gatewayViewAbi,
      functionName: "usedJob",
      args: [env.job.jobId],
    });
    const out = {
      label,
      relayer: account.address,
      jobId: env.job.jobId,
      txHash: null,
      blockNumber: null,
      status: null,
      result: "unavailable-before-consume",
      revertSelector: null,
      potBefore: pot.toString(),
      potAfter: pot.toString(),
      usedJob,
      jobConsumed: false,
      jobConsumedRelayer: null,
      pulledIdenticalJob: true,
      humanInLoop: false,
      aiInLoop: false,
    };
    writeFileSync(mustEnv("RELAYER_OUT"), JSON.stringify(out, null, 2) + "\n");
    console.log(JSON.stringify({ role: "relayer", ...out }));
    return;
  }

  const potBefore = await client.readContract({
    address: mustEnv("FLYWHEEL") as `0x${string}`,
    abi: flywheelAbi,
    functionName: "usdcPot",
  });

  let hash: Hex | undefined;
  let receipt: TransactionReceipt | undefined;
  let result = "unknown";
  let revertSelector: string | undefined;
  try {
    hash = await wallet.sendTransaction({ to: env.job.gateway, data, account, chain, gas: 800_000n });
    receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") {
      result = "consumed";
    } else {
      const replay = await classifyReplay(client, env.job.gateway, data, account.address);
      revertSelector = replay.selector;
      result = replay.replay ? "Replay" : `reverted:${replay.selector ?? "unknown"}`;
    }
  } catch (e) {
    const replay = classifyError(e);
    revertSelector = replay.selector;
    if (replay.replay) {
      result = "Replay";
    } else if (submitRpc !== rpc) {
      result = "unavailable-before-consume";
    } else {
      result = `revert:${replay.selector ?? (e instanceof Error ? e.message.slice(0, 120) : "error")}`;
    }
  }

  const potAfter = await client.readContract({
    address: mustEnv("FLYWHEEL") as `0x${string}`,
    abi: flywheelAbi,
    functionName: "usdcPot",
  });
  const usedJob = await client.readContract({
    address: env.job.gateway,
    abi: gatewayViewAbi,
    functionName: "usedJob",
    args: [env.job.jobId],
  });
  const consumedLog = (receipt?.logs ?? []).find((l) => l.topics[0] === JOB_CONSUMED);

  const out = {
    label,
    relayer: account.address,
    jobId: env.job.jobId,
    txHash: hash ?? null,
    blockNumber: receipt ? receipt.blockNumber.toString() : null,
    status: receipt?.status ?? null,
    result,
    revertSelector: revertSelector ?? null,
    potBefore: potBefore.toString(),
    potAfter: potAfter.toString(),
    usedJob,
    jobConsumed: Boolean(consumedLog),
    jobConsumedRelayer: consumedLog?.topics[2] ? `0x${consumedLog.topics[2].slice(26)}` : null,
    humanInLoop: false,
    aiInLoop: false,
  };
  writeFileSync(mustEnv("RELAYER_OUT"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ role: "relayer", ...out }));
  if (result !== "consumed" && result !== "Replay" && result !== "unavailable-before-consume") process.exit(1);
}

async function evmIncreaseTime(rpc: string, seconds: number) {
  await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 40, method: "evm_increaseTime", params: [seconds] }),
  });
  await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 41, method: "evm_mine", params: [] }),
  });
}

function classifyError(e: unknown): { replay: boolean; selector?: Hex } {
  const msg = e instanceof Error ? `${e.message} ${e.stack ?? ""}` : String(e);
  const data =
    e && typeof e === "object" && "data" in e
      ? String((e as { data?: unknown }).data)
      : msg;
  const replay = data.toLowerCase().includes(REPLAY_SEL.toLowerCase()) || /\bReplay\b/.test(msg);
  const m = data.match(/0x[0-9a-fA-F]{8}/);
  return { replay, selector: replay ? REPLAY_SEL : ((m?.[0].toLowerCase() as Hex | undefined) ?? undefined) };
}

async function classifyReplay(
  client: ReturnType<typeof createPublicClient>,
  to: `0x${string}`,
  data: Hex,
  from: `0x${string}`,
): Promise<{ replay: boolean; selector?: Hex }> {
  try {
    await client.call({ to, data, account: from });
    return { replay: false };
  } catch (e) {
    return classifyError(e);
  }
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

function waitHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(url)
        .then((r) => {
          if (r.ok) resolve();
          else if (Date.now() - start > timeoutMs) reject(new Error(`timeout ${url}`));
          else setTimeout(tick, 200);
        })
        .catch(() => {
          if (Date.now() - start > timeoutMs) reject(new Error(`timeout ${url}`));
          else setTimeout(tick, 200);
        });
    };
    tick();
  });
}

async function waitRpc(rpc: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`RPC not ready: ${rpc}`);
}

function restoreDumps(backups: Array<{ path: string; data: string }>) {
  for (const b of backups) writeFileSync(b.path, b.data);
}

async function orchestrate() {
  const anvilBin = foundryBin("anvil");
  const forge = foundryBin("forge");
  if (process.env.REQUIRE_ANVIL === "1" && !anvilBin) throw new Error("anvil required (CI full/main solidity + size-guard)");
  if (!anvilBin || !forge) {
    throw new Error("anvil + forge required to deploy a Gateway and rehearse autonomous relays. Do not run from indexer unit suite.");
  }

  const dumpPaths = [
    join(ROOT, "deployments/local.json"),
    join(ROOT, "apps/web/src/lib/deployment.json"),
    join(ROOT, "apps/indexer/src/deployment.json"),
  ];
  const backups = dumpPaths.filter((p) => existsSync(p)).map((p) => ({ path: p, data: readFileSync(p, "utf8") }));

  const work = mkdtempSync(join(tmpdir(), "autonomous-relay-"));
  const port = Number(process.env.ANVIL_PORT ?? 18545);
  const rpc = process.env.GATEWAY_RPC ?? `http://127.0.0.1:${port}`;
  const children: ChildProcess[] = [];
  let anvil: ChildProcess | undefined;

  const cleanup = () => {
    for (const c of children) {
      try {
        c.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    if (anvil) {
      try {
        anvil.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    restoreDumps(backups);
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    if (!process.env.GATEWAY_RPC) {
      anvil = spawn(anvilBin, ["--chain-id", String(LOCAL_CHAIN), "--port", String(port), "--gas-limit", "100000000"], {
        stdio: "ignore",
      });
      children.push(anvil);
      await waitRpc(rpc);
    }

    const client = createPublicClient({ transport: http(rpc) });
    const chainId = await client.getChainId();
    if (chainId === MAINNET) throw new Error("5042 disabled");

    let deployed: Deployed;
    if (process.env.AUTONOMOUS_RELAY_DEPLOY && existsSync(process.env.AUTONOMOUS_RELAY_DEPLOY)) {
      deployed = JSON.parse(readFileSync(process.env.AUTONOMOUS_RELAY_DEPLOY, "utf8")) as Deployed;
    } else {
      const env = {
        ...process.env,
        PATH: `${join(process.env.HOME ?? "", ".foundry/bin")}:${process.env.PATH ?? ""}`,
        DEPLOYER_PK: ANVIL.deployer.pk,
        JOB_SIGNER: ANVIL.signer.addr,
      };
      const r = spawnSync(
        forge,
        ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", rpc, "--broadcast", "--legacy"],
        { cwd: join(ROOT, "contracts"), encoding: "utf8", env, stdio: ["ignore", "inherit", "inherit"] },
      );
      if (r.status !== 0) {
        throw new Error(`Deploy.s.sol failed (status ${r.status})`);
      }
      const dumped = JSON.parse(readFileSync(join(ROOT, "deployments/local.json"), "utf8")) as {
        chainId: number;
        addresses: Record<string, string>;
      };
      restoreDumps(backups);
      deployed = {
        chainId,
        rpc,
        claimedArcTestnet: false,
        addresses: {
          AutomationGateway: dumped.addresses.AutomationGateway as `0x${string}`,
          JobSigner: dumped.addresses.JobSigner as `0x${string}`,
          USDC: dumped.addresses.USDC as `0x${string}`,
          FlywheelVault: dumped.addresses.FlywheelVault as `0x${string}`,
          ReactorHook: dumped.addresses.ReactorHook as `0x${string}`,
          Guardian: dumped.addresses.Guardian as `0x${string}`,
        },
      };
    }

    if (!deployed.addresses.AutomationGateway) throw new Error("deploy dump missing AutomationGateway");
    if (deployed.addresses.JobSigner.toLowerCase() !== ANVIL.signer.addr.toLowerCase() && !process.env.JOB_SIGNER_PRIVATE_KEY) {
      throw new Error(`jobSigner ${deployed.addresses.JobSigner} is not the rehearsal signer`);
    }

    const keeper = await client.readContract({
      address: deployed.addresses.Guardian,
      abi: guardianAbi,
      functionName: "keeper",
    });
    if (keeper.toLowerCase() !== deployed.addresses.AutomationGateway.toLowerCase()) {
      throw new Error("Guardian.keeper is not AutomationGateway");
    }

    mkdirSync(dirname(DEPLOY_SNAP), { recursive: true });
    writeFileSync(DEPLOY_SNAP, JSON.stringify({ ...deployed, note: "Rehearsal dump only. Not claimed Arc Public Testnet. Not 5042." }, null, 2) + "\n");

    const seedAmt = 50_000n * 1_000_000n;
    const chain = chainOf(chainId, rpc);
    const deployerAcct = privateKeyToAccount(ANVIL.deployer.pk);
    const deployerWallet = createWalletClient({
      account: deployerAcct,
      chain,
      transport: http(rpc),
    });
    await deployerWallet.writeContract({
      address: deployed.addresses.USDC,
      abi: mintAbi,
      functionName: "mint",
      args: [deployed.addresses.FlywheelVault, seedAmt],
      account: deployerAcct,
      chain,
    });
    for (const [id, method, params] of [
      [1, "anvil_impersonateAccount", [deployed.addresses.ReactorHook]],
      [2, "anvil_setBalance", [deployed.addresses.ReactorHook, "0x56BC75E2D63100000"]],
    ] as const) {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      if (!r.ok) throw new Error(`${method} failed`);
    }
    const accrueTx = encodeFunctionData({
      abi: flywheelAbi,
      functionName: "accrue",
      args: [deployed.addresses.USDC, seedAmt],
    });
    const seedSend = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "eth_sendTransaction",
        params: [
          {
            from: deployed.addresses.ReactorHook,
            to: deployed.addresses.FlywheelVault,
            data: accrueTx,
          },
        ],
      }),
    });
    const seedJson = (await seedSend.json()) as { result?: string; error?: { message?: string } };
    if (!seedJson.result) throw new Error(`hook accrue failed: ${seedJson.error?.message ?? "no hash"}`);
    await client.waitForTransactionReceipt({ hash: seedJson.result as Hex });
    const take = await client.readContract({
      address: deployed.addresses.FlywheelVault,
      abi: flywheelAbi,
      functionName: "settleTake",
      args: [deployed.addresses.USDC],
    });
    if (take === 0n) throw new Error("flywheel seed did not accrue (settleTake=0)");

    const signerPortFile = join(work, "signer.port");
    const signer = spawnSelf("signer", {
      ROLE: "signer",
      GATEWAY_RPC: rpc,
      GATEWAY: deployed.addresses.AutomationGateway,
      USDC: deployed.addresses.USDC,
      FLYWHEEL: deployed.addresses.FlywheelVault,
      JOB_SIGNER_PRIVATE_KEY: process.env.JOB_SIGNER_PRIVATE_KEY ?? ANVIL.signer.pk,
      SIGNER_PORT_FILE: signerPortFile,
      RELAYER_PRIVATE_KEY: "",
    });
    children.push(signer);
    const started = Date.now();
    while (!existsSync(signerPortFile)) {
      if (Date.now() - started > 15_000) throw new Error("signer did not bind");
      await new Promise((r) => setTimeout(r, 50));
    }
    const signerPort = readFileSync(signerPortFile, "utf8").trim();
    const signerBase = `http://127.0.0.1:${signerPort}`;
    await waitHttp(`${signerBase}/health`);

    const produceJob = async () => {
      const produced = await fetch(`${signerBase}/produce`, { method: "POST" });
      if (!produced.ok) throw new Error(`signer produce failed: ${await produced.text()}`);
      return parseEnvelope(await produced.json());
    };

    const external = Boolean(process.env.GATEWAY_RPC);
    const pkA = (external ? (process.env.RELAYER_A_PRIVATE_KEY as Hex | undefined) : undefined) ?? ANVIL.relayerA.pk;
    const pkB = (external ? (process.env.RELAYER_B_PRIVATE_KEY as Hex | undefined) : undefined) ?? ANVIL.relayerB.pk;

    const runRelayerChild = (opts: {
      scenario: string;
      label: "A" | "B";
      pk: Hex;
      mode?: "submit" | "fail-before-send";
      submitRpc?: string;
    }) => {
      const out = join(work, `${opts.scenario}-${opts.label}.json`);
      const child = spawnSelf("relayer", {
        ROLE: "relayer",
        RELAYER_LABEL: opts.label,
        RELAYER_MODE: opts.mode ?? "submit",
        GATEWAY_RPC: rpc,
        SUBMIT_RPC: opts.submitRpc ?? rpc,
        SUBMIT_TIMEOUT_MS: "2000",
        FLYWHEEL: deployed.addresses.FlywheelVault,
        RELAYER_PRIVATE_KEY: opts.pk,
        JOB_URL: `${signerBase}/job`,
        RELAYER_OUT: out,
        JOB_SIGNER_PRIVATE_KEY: "",
      });
      children.push(child);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        child.on("exit", (c) => {
          if (!existsSync(out)) {
            reject(new Error(`relayer ${opts.scenario}/${opts.label} wrote no receipt (exit ${c ?? 1})`));
            return;
          }
          resolve(JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>);
        });
      });
    };

    const assertDistinctCouriers = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      if (String(a.relayer).toLowerCase() === String(b.relayer).toLowerCase()) {
        throw new Error("relayer A and B must be distinct EOAs");
      }
      if (String(a.relayer).toLowerCase() === ANVIL.signer.addr.toLowerCase()) {
        throw new Error("relayer must not be the job signer");
      }
    };

    const failoverJob = await produceJob();
    const [failoverA, failoverB] = await Promise.all([
      runRelayerChild({
        scenario: "failover",
        label: "A",
        pk: pkA,
        submitRpc: "http://127.0.0.1:9",
      }),
      runRelayerChild({ scenario: "failover", label: "B", pk: pkB }),
    ]);
    if (failoverA.result !== "unavailable-before-consume") {
      throw new Error(`failover A expected unavailable-before-consume, got ${failoverA.result}`);
    }
    if (failoverA.txHash) throw new Error("failover A must not submit a transaction");
    if (failoverA.jobConsumed === true) throw new Error("failover A must not emit JobConsumed");
    if (failoverA.jobId !== failoverJob.job.jobId) throw new Error("failover A pulled a different job");

    if (failoverB.result !== "consumed") {
      throw new Error(`failover B expected consume while A was down, got ${failoverB.result}`);
    }
    if (failoverB.jobConsumed !== true) throw new Error("failover B missing JobConsumed");
    if (failoverB.jobId !== failoverJob.job.jobId) throw new Error("failover B pulled a different job");
    if (failoverB.potBefore === failoverB.potAfter) throw new Error("failover B did not move the pot");
    if (!failoverB.txHash) throw new Error("failover B must produce a transaction hash");
    assertDistinctCouriers(failoverA, failoverB);

    await evmIncreaseTime(rpc, 5 * 60 + 1);
    const raceJob = await produceJob();
    if (raceJob.job.jobId === failoverJob.job.jobId) throw new Error("race job must be a new signed job");

    const [raceA, raceB] = await Promise.all([
      runRelayerChild({ scenario: "race", label: "A", pk: pkA }),
      runRelayerChild({ scenario: "race", label: "B", pk: pkB }),
    ]);
    const raceResults = [raceA, raceB];
    const raceConsumed = raceResults.filter((r) => r.result === "consumed");
    const raceReplay = raceResults.filter((r) => r.result === "Replay");
    if (raceConsumed.length !== 1 || raceReplay.length !== 1) {
      throw new Error(
        `race expected exactly one consume + one Replay, got A=${raceA.result} B=${raceB.result}`,
      );
    }
    if (raceA.jobId !== raceJob.job.jobId || raceB.jobId !== raceJob.job.jobId) {
      throw new Error("race relayers must pull the identical signed job");
    }
    if (!raceA.txHash || !raceB.txHash || raceA.txHash === raceB.txHash) {
      throw new Error("race relayers must submit distinct transactions");
    }
    if (raceA.potAfter !== raceB.potAfter) throw new Error("race loser moved the pot");
    if (raceConsumed[0]!.potBefore === raceConsumed[0]!.potAfter) {
      throw new Error("race winner did not move the pot");
    }
    if (raceConsumed[0]!.jobConsumed !== true) throw new Error("race winner missing JobConsumed");
    assertDistinctCouriers(raceA, raceB);

    const evidence = {
      kind: "deployed-gateway-autonomous-relay",
      interface: "MaintenanceJob EIP-712 settleQuote",
      decisionAuthority: "canonical signer service — not relayer A, not relayer B, not CRE, not Gelato",
      ranking: "ValuationService / GET /top10 — CRE does not rank. This rehearsal is settleQuote only.",
      environment:
        "Deployed AutomationGateway on local Anvil chain 5042002 via Deploy.s.sol. Not a live CRE DON. Not claimed Arc Public Testnet. Not Arc Mainnet 5042.",
      chainId,
      rpc,
      claimedArcTestnet: false,
      arcMainnet5042: "disabled — no addresses, no CRE production writes",
      humanInLoop: false,
      aiInLoop: false,
      gateway: deployed.addresses.AutomationGateway,
      jobSigner: deployed.addresses.JobSigner,
      flywheel: deployed.addresses.FlywheelVault,
      usdc: deployed.addresses.USDC,
      scenarios: {
        failoverLiveness: {
          description:
            "A and B start together. A’s submit RPC is down (fails before consume). B consumes the same signed job without waiting for A=consumed.",
          jobId: failoverJob.job.jobId,
          validAfter: failoverJob.job.validAfter.toString(),
          deadline: failoverJob.job.deadline.toString(),
          amount: failoverJob.amount.toString(),
          relayerA: failoverA,
          relayerB: failoverB,
          bConsumedWithoutA: failoverA.result === "unavailable-before-consume" && failoverB.result === "consumed",
        },
        raceIdempotency: {
          description:
            "A and B start simultaneously against one signed job. Exactly one JobConsumed; the other is Replay.",
          jobId: raceJob.job.jobId,
          validAfter: raceJob.job.validAfter.toString(),
          deadline: raceJob.job.deadline.toString(),
          amount: raceJob.amount.toString(),
          relayerA: raceA,
          relayerB: raceB,
          consumedCount: raceConsumed.length,
          replayCount: raceReplay.length,
          winner: raceA.result === "consumed" ? "A" : "B",
          oneLogicalExecution: raceConsumed.length === 1 && raceReplay.length === 1,
        },
      },
      proof: "scripts/autonomous-relay-failover.ts (signer HTTP + failover liveness + simultaneous race)",
    };
    mkdirSync(dirname(EVIDENCE), { recursive: true });
    writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
    console.log("autonomous relay failover rehearsal ok", {
      kind: evidence.kind,
      gateway: evidence.gateway,
      failover: {
        jobId: failoverJob.job.jobId,
        a: failoverA.result,
        b: failoverB.txHash,
      },
      race: {
        jobId: raceJob.job.jobId,
        a: raceA.result,
        b: raceB.result,
        winner: evidence.scenarios.raceIdempotency.winner,
      },
    });
  } finally {
    cleanup();
  }
}

function main() {
  const role = process.argv[2] ?? process.env.ROLE ?? "orchestrate";
  const run =
    role === "signer" ? runSigner : role === "relayer" ? runRelayer : role === "orchestrate" ? orchestrate : null;
  if (!run) throw new Error(`unknown role ${role}`);
  return run();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
