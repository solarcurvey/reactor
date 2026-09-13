import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {
  maintenanceEnvelopeFromJson,
  maintenanceEnvelopeToJson,
  type SignedMaintenanceEnvelope,
  type UnsignedMaintenanceEnvelope,
} from "../../../packages/reactor/src/maintenance-envelope.ts";
import { createAwsKmsDigestSigner } from "./aws-kms-backend.ts";
import { KmsDigestSigner, kmsToAccount } from "./kms-evm.ts";
import {
  assertManagedRelayProductionEnv,
  authorizeMaintenanceEnvelope,
  relayMaintenanceEnvelope,
  type RelayChain,
} from "./managed-relay-core.ts";

const gatewayAbi = parseAbi(["function usedJob(bytes32) view returns (bool)"]);
const ARC_MAINNET_CHAIN_ID = 5042n;

type Env = NodeJS.ProcessEnv;

type RuntimeConfig = {
  chainId: bigint;
  rpcUrl: string;
  gateway: Address;
  expectedSigner: Address;
  apiBase: string;
  apiToken: string;
  awsRegion?: string;
};

function required(env: Env, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`${name} required`);
  return v;
}

function addressEnv(env: Env, name: string): Address {
  const v = required(env, name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`${name} must be EVM address`);
  return v as Address;
}

async function secretValue(secretId: string, region?: string): Promise<string> {
  const moduleName = "@aws-sdk/client-secrets-manager";
  const aws = (await import(moduleName)) as Record<string, new (...args: never[]) => unknown>;
  const SecretsManagerClient = aws.SecretsManagerClient as unknown as new (config: Record<string, unknown>) => { send(command: unknown): Promise<unknown> };
  const GetSecretValueCommand = aws.GetSecretValueCommand as unknown as new (input: Record<string, unknown>) => unknown;
  if (!SecretsManagerClient || !GetSecretValueCommand) throw new Error("AWS Secrets Manager SDK v3 unavailable");
  const client = new SecretsManagerClient({ region });
  const out = (await client.send(new GetSecretValueCommand({ SecretId: secretId }))) as { SecretString?: string };
  if (!out.SecretString?.trim()) throw new Error(`runtime secret ${secretId} empty`);
  return out.SecretString.trim();
}

async function runtimeSecret(env: Env, directName: string, secretName: string): Promise<string> {
  const prod = (env.REACTOR_ENV ?? "").toUpperCase() === "PROD" || env.NODE_ENV === "production";
  if (prod && env[directName]) throw new Error(`${directName} forbidden in production; use Secrets Manager`);
  if (env[secretName]) return secretValue(env[secretName]!, env.AWS_REGION);
  if (env[directName]) return env[directName]!;
  throw new Error(`${directName}/${secretName} unavailable`);
}

async function config(env: Env = process.env): Promise<RuntimeConfig> {
  assertManagedRelayProductionEnv(env);
  const chainId = BigInt(required(env, "MAINTENANCE_CHAIN_ID"));
  if (chainId === ARC_MAINNET_CHAIN_ID) throw new Error("Arc Mainnet 5042 is hard-disabled for #83");
  return {
    chainId,
    rpcUrl: await runtimeSecret(env, "MAINTENANCE_RPC_URL", "MAINTENANCE_RPC_URL_SECRET_ID"),
    gateway: addressEnv(env, "MAINTENANCE_GATEWAY_ADDRESS"),
    expectedSigner: addressEnv(env, "MAINTENANCE_JOB_SIGNER_ADDRESS"),
    apiBase: required(env, "MAINTENANCE_API_BASE").replace(/\/$/, ""),
    apiToken: await runtimeSecret(env, "MAINTENANCE_API_TOKEN", "MAINTENANCE_API_TOKEN_SECRET_ID"),
    awsRegion: env.AWS_REGION,
  };
}

async function apiRequest(cfg: RuntimeConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown | null> {
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.apiToken}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`maintenance API ${method} ${path} -> ${res.status}`);
  return res.json();
}

function unwrapItem(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "item" in (raw as Record<string, unknown>)) return (raw as Record<string, unknown>).item;
  return raw;
}

function chainClients(cfg: RuntimeConfig, account?: Awaited<ReturnType<typeof kmsToAccount>>) {
  const chain = defineChain({
    id: Number(cfg.chainId),
    name: "REACTOR managed relay",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl, { timeout: 8_000 }) });
  const walletClient = account ? createWalletClient({ account, chain, transport: http(cfg.rpcUrl, { timeout: 8_000 }) }) : undefined;
  return { chain, publicClient, walletClient };
}

function emitMetric(role: string, values: Record<string, number>) {
  const metrics = Object.keys(values).map((Name) => ({ Name, Unit: Name.includes("Balance") ? "None" : "Count" }));
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{ Namespace: "REACTOR/ManagedRelay", Dimensions: [["Role"]], Metrics: metrics }],
    },
    Role: role,
    ...values,
  }));
}

export async function authorizerHandler(_event: unknown, _context: unknown, env: Env = process.env) {
  const cfg = await config(env);
  const raw = unwrapItem(await apiRequest(cfg, "GET", "/ops/maintenance/unsigned"));
  if (!raw) {
    emitMetric("authorizer", { Heartbeat: 1, JobsSigned: 0 });
    return { ok: true, idle: true };
  }
  const unsigned = maintenanceEnvelopeFromJson(raw, false) as UnsignedMaintenanceEnvelope;
  const { publicClient } = chainClients(cfg);
  const block = await publicClient.getBlock();
  const backend = await createAwsKmsDigestSigner({ keyId: required(env, "MAINTENANCE_KMS_KEY_ID"), region: cfg.awsRegion });
  const signer = new KmsDigestSigner(backend);
  const signed = await authorizeMaintenanceEnvelope(unsigned, signer, { chainId: cfg.chainId, gateway: cfg.gateway, expectedSigner: cfg.expectedSigner }, block.timestamp);
  await apiRequest(cfg, "POST", "/ops/maintenance/signed", maintenanceEnvelopeToJson(signed));
  emitMetric("authorizer", { Heartbeat: 1, JobsSigned: 1 });
  console.log(JSON.stringify({ role: "authorizer", jobId: signed.job.jobId, signer: await signer.address(), status: "signed" }));
  return { ok: true, jobId: signed.job.jobId };
}

async function relayHandlerFor(label: "A" | "B", env: Env) {
  const cfg = await config(env);
  const keyName = label === "A" ? "RELAY_A_KMS_KEY_ID" : "RELAY_B_KMS_KEY_ID";
  const backend = await createAwsKmsDigestSigner({ keyId: required(env, keyName), region: cfg.awsRegion });
  const account = await kmsToAccount(backend);
  if (account.address.toLowerCase() === cfg.expectedSigner.toLowerCase()) throw new Error(`Relay ${label} key reuses maintenance signer`);
  const forbidden = (env.MAINTENANCE_FORBIDDEN_ADDRESSES ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (forbidden.includes(account.address.toLowerCase())) throw new Error(`Relay ${label} key reuses forbidden privileged address`);

  const raw = unwrapItem(await apiRequest(cfg, "GET", "/ops/maintenance/signed"));
  const { publicClient, walletClient, chain } = chainClients(cfg, account);
  const balance = await publicClient.getBalance({ address: account.address }).catch(() => 0n);
  if (!raw) {
    emitMetric(`relay-${label}`, { Heartbeat: 1, RelayGasBalance: Number(formatUnits(balance, 18)), JobsConsumed: 0 });
    return { ok: true, idle: true, relay: label, address: account.address };
  }
  const signed = maintenanceEnvelopeFromJson(raw, true) as SignedMaintenanceEnvelope;
  if (!walletClient) throw new Error("wallet client unavailable");
  const relayChain: RelayChain = {
    async nowSec() { return (await publicClient.getBlock()).timestamp; },
    async usedJob(gateway, jobId) {
      return publicClient.readContract({ address: gateway, abi: gatewayAbi, functionName: "usedJob", args: [jobId] });
    },
    async simulate({ to, data }) {
      await publicClient.call({ account: account.address, to, data });
    },
    async send({ to, data }) {
      return walletClient.sendTransaction({ account, chain, to, data });
    },
    async receipt(hash: Hex) {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
        return { status: receipt.status === "success" ? "success" : "reverted" };
      } catch {
        return null;
      }
    },
  };
  const result = await relayMaintenanceEnvelope(signed, relayChain, {
    chainId: cfg.chainId,
    gateway: cfg.gateway,
    expectedSigner: cfg.expectedSigner,
    relayLabel: label,
    delayMs: label === "B" ? Number(env.RELAY_B_DELAY_MS ?? 15_000) : 0,
  });
  await apiRequest(cfg, "POST", "/ops/maintenance/result", { ...result, address: account.address });
  emitMetric(`relay-${label}`, {
    Heartbeat: 1,
    RelayGasBalance: Number(formatUnits(balance, 18)),
    JobsConsumed: result.status === "consumed" ? 1 : 0,
    RelayFailure: result.status === "failed" || result.status === "ambiguous" ? 1 : 0,
  });
  console.log(JSON.stringify({ role: `relay-${label}`, address: account.address, jobId: signed.job.jobId, status: result.status, txHash: "txHash" in result ? result.txHash : null }));
  if (result.status === "failed") throw new Error(`relay ${label} failed: ${result.error}`);
  if (result.status === "ambiguous") throw new Error(`relay ${label} ambiguous receipt: ${result.txHash}`);
  return { ok: true, relay: label, address: account.address, ...result };
}

export async function relayAHandler(_event: unknown, _context: unknown, env: Env = process.env) {
  return relayHandlerFor("A", env);
}

export async function relayBHandler(_event: unknown, _context: unknown, env: Env = process.env) {
  return relayHandlerFor("B", env);
}
