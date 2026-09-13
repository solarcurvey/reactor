import { awsKmsBackend, resolveKmsAddress, signDigestWithKms, signTransactionWithKms } from "./kms.mjs";
import {
  GATEWAY_ABI,
  assertArgsMatchJob,
  assertJobWindow,
  makeSignedEnvelope,
  maintenanceJobDigest,
  normalizeJob,
  relayDelayMs,
  verifySignedEnvelope,
} from "./job.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertNoRawProductionKeys() {
  if ((process.env.REACTOR_ENV ?? "PROD").toUpperCase() !== "PROD") return;
  for (const name of ["JOB_SIGNER_PRIVATE_KEY", "KEEPER_PRIVATE_KEY", "RELAYER_PRIVATE_KEY"]) {
    if (process.env[name]) throw new Error(`${name} is forbidden in the AWS managed production path`);
  }
}

async function emitMetric(name, value, role) {
  if (process.env.REACTOR_DISABLE_METRICS === "1") return;
  const { CloudWatchClient, PutMetricDataCommand } = await import("@aws-sdk/client-cloudwatch");
  const client = new CloudWatchClient({ region: process.env.AWS_REGION });
  await client.send(
    new PutMetricDataCommand({
      Namespace: process.env.REACTOR_METRIC_NAMESPACE ?? "REACTOR/Automation",
      MetricData: [
        {
          MetricName: name,
          Value: Number(value),
          Unit: "Count",
          Dimensions: [{ Name: "Role", Value: role }],
        },
      ],
    }),
  );
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.REACTOR_HTTP_TIMEOUT_MS ?? 8_000));
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function authorizer() {
  const role = "authorizer";
  const chainId = BigInt(required("REACTOR_CHAIN_ID"));
  const gateway = required("REACTOR_GATEWAY");
  const keyId = required("REACTOR_KMS_KEY_ID");
  const backend = await awsKmsBackend();
  const planUrl = required("REACTOR_PLAN_URL");
  const raw = await fetchJson(planUrl);
  await emitMetric("Heartbeat", 1, role);
  if (!raw) return { ok: true, role, idle: true };
  const plan = raw.plan ?? raw;
  const job = normalizeJob(plan.job);
  if (job.chainId !== chainId) throw new Error("canonical plan chain does not match authorizer chain");
  const { getAddress } = await import("viem");
  if (getAddress(job.gateway) !== getAddress(gateway)) throw new Error("canonical plan gateway mismatch");
  assertJobWindow(job);
  await assertArgsMatchJob(job, plan.args);
  const digest = await maintenanceJobDigest(job);
  const expectedAddress = process.env.REACTOR_EXPECTED_KMS_ADDRESS || undefined;
  const signed = await signDigestWithKms({ backend, keyId, digest, expectedAddress });
  const envelope = await makeSignedEnvelope({ job, signature: signed.serialized, args: plan.args });
  const sink = process.env.REACTOR_SIGNED_JOB_SINK_URL;
  if (sink) {
    await fetchJson(sink, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
  }
  await emitMetric("Authorizations", 1, role);
  return { ok: true, role, signer: signed.signer, jobId: job.jobId, delivered: Boolean(sink), envelope: sink ? undefined : envelope };
}

async function relay(role) {
  const { createPublicClient, getAddress, http } = await import("viem");
  const chainId = BigInt(required("REACTOR_CHAIN_ID"));
  const gateway = getAddress(required("REACTOR_GATEWAY"));
  const keyId = required("REACTOR_KMS_KEY_ID");
  const rpc = required("REACTOR_RPC_URL");
  const source = required("REACTOR_SIGNED_JOB_SOURCE_URL");
  const delay = relayDelayMs(role, process.env.REACTOR_RELAY_DELAY_MS);

  const backend = await awsKmsBackend();
  const relayAddress = await resolveKmsAddress(backend, keyId, process.env.REACTOR_EXPECTED_KMS_ADDRESS || undefined);
  const jobSigner = process.env.REACTOR_JOB_SIGNER_ADDRESS
    ? getAddress(process.env.REACTOR_JOB_SIGNER_ADDRESS)
    : await resolveKmsAddress(backend, required("REACTOR_JOB_SIGNER_KMS_KEY_ID"));
  const client = createPublicClient({ transport: http(rpc, { timeout: Number(process.env.REACTOR_RPC_TIMEOUT_MS ?? 8_000) }) });
  const actualChain = BigInt(await client.getChainId());
  if (actualChain !== chainId) throw new Error(`RPC chain mismatch: expected ${chainId}, got ${actualChain}`);

  const raw = await fetchJson(source);
  await emitMetric("Heartbeat", 1, role);
  const balance = await client.getBalance({ address: relayAddress });
  await emitMetric("RelayGasBalanceWei", balance, role);
  if (!raw) return { ok: true, role, idle: true, relay: relayAddress };
  const envelope = raw.envelope ?? (Array.isArray(raw.jobs) ? raw.jobs[0] : raw);
  if (!envelope) return { ok: true, role, idle: true, relay: relayAddress };

  // Relay B's grace period applies only when a real pending envelope exists.
  // Idle ticks return immediately, avoiding ~15s of billed Lambda duration per minute.
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

  const verified = await verifySignedEnvelope(envelope, { chainId, gateway, jobSigner });
  const used = await client.readContract({
    address: gateway,
    abi: GATEWAY_ABI,
    functionName: "usedJob",
    args: [verified.job.jobId],
  });
  if (used) {
    await emitMetric("AlreadyConsumed", 1, role);
    return { ok: true, role, relay: relayAddress, jobId: verified.job.jobId, status: "already-consumed" };
  }

  await client.call({ account: relayAddress, to: gateway, data: verified.calldata });
  const nonce = await client.getTransactionCount({ address: relayAddress, blockTag: "pending" });
  const gasEstimate = await client.estimateGas({ account: relayAddress, to: gateway, data: verified.calldata });
  const gas = (gasEstimate * 120n) / 100n;
  let transaction;
  try {
    const fees = await client.estimateFeesPerGas();
    if (fees.maxFeePerGas !== undefined && fees.maxPriorityFeePerGas !== undefined) {
      transaction = {
        type: "eip1559",
        chainId: Number(chainId),
        nonce,
        to: gateway,
        data: verified.calldata,
        value: 0n,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      };
    }
  } catch {
    // fall through to legacy gasPrice path
  }
  if (!transaction) {
    transaction = {
      type: "legacy",
      chainId: Number(chainId),
      nonce,
      to: gateway,
      data: verified.calldata,
      value: 0n,
      gas,
      gasPrice: await client.getGasPrice(),
    };
  }

  const signedTx = await signTransactionWithKms({
    backend,
    keyId,
    expectedAddress: relayAddress,
    transaction,
  });
  const txHash = await client.sendRawTransaction({ serializedTransaction: signedTx.serializedTransaction });
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    timeout: Number(process.env.REACTOR_RECEIPT_TIMEOUT_MS ?? 60_000),
  });
  if (receipt.status !== "success") {
    const consumedAfter = await client.readContract({
      address: gateway,
      abi: GATEWAY_ABI,
      functionName: "usedJob",
      args: [verified.job.jobId],
    });
    if (consumedAfter) {
      await emitMetric("ReplayRace", 1, role);
      return { ok: true, role, relay: relayAddress, jobId: verified.job.jobId, txHash, status: "replay-race" };
    }
    throw new Error(`relay transaction reverted: ${txHash}`);
  }
  await emitMetric("RelaySuccess", 1, role);
  return { ok: true, role, relay: relayAddress, jobId: verified.job.jobId, txHash, status: "consumed" };
}

export async function handler() {
  assertNoRawProductionKeys();
  const role = (process.env.REACTOR_ROLE ?? "").toLowerCase();
  if (role === "authorizer") return authorizer();
  if (role === "relay-a") return relay("A");
  if (role === "relay-b") return relay("B");
  throw new Error(`unknown REACTOR_ROLE ${role || "<empty>"}`);
}

export const __handlerTest = { assertNoRawProductionKeys };
