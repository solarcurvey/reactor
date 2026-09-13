import {
  getAddress,
  recoverAddress,
  type Address,
  type Hex,
} from "viem";
import {
  assertMaintenanceEnvelope,
  encodeRelayCalldata,
  type SignedMaintenanceEnvelope,
  type UnsignedMaintenanceEnvelope,
} from "../../../packages/reactor/src/maintenance-envelope.ts";
import {
  maintenanceDomainSeparator,
  maintenanceJobDigest,
} from "../../../packages/reactor/src/maintenance-job.ts";
import type { KmsDigestSigner } from "./kms-evm.ts";

export type AuthorizerPolicy = {
  chainId: bigint;
  gateway: Address;
  expectedSigner?: Address;
};

export type RelayPolicy = AuthorizerPolicy & {
  expectedSigner: Address;
  relayLabel: string;
  delayMs?: number;
};

export type RelayChain = {
  nowSec(): Promise<bigint>;
  usedJob(gateway: Address, jobId: Hex): Promise<boolean>;
  simulate(args: { to: Address; data: Hex }): Promise<void>;
  send(args: { to: Address; data: Hex }): Promise<Hex>;
  receipt(hash: Hex): Promise<{ status: "success" | "reverted" } | null>;
};

export type RelayResult =
  | { status: "consumed"; txHash: Hex; jobId: Hex; relay: string }
  | { status: "already-used" | "replay"; jobId: Hex; relay: string; txHash?: Hex }
  | { status: "ambiguous"; txHash: Hex; jobId: Hex; relay: string }
  | { status: "failed"; jobId: Hex; relay: string; error: string; txHash?: Hex };

export function maintenanceDigest(job: UnsignedMaintenanceEnvelope["job"]): Hex {
  return maintenanceJobDigest(maintenanceDomainSeparator(job.chainId, job.gateway), job);
}

export async function authorizeMaintenanceEnvelope(
  env: UnsignedMaintenanceEnvelope,
  signer: KmsDigestSigner,
  policy: AuthorizerPolicy,
  nowSec: bigint,
): Promise<SignedMaintenanceEnvelope> {
  assertMaintenanceEnvelope(env, {
    gateway: policy.gateway,
    chainId: policy.chainId,
    nowSec,
  });
  const signerAddress = await signer.address();
  if (policy.expectedSigner && getAddress(signerAddress) !== getAddress(policy.expectedSigner)) {
    throw new Error("maintenance KMS signer address mismatch");
  }
  const signature = await signer.signDigest(maintenanceDigest(env.job));
  const recovered = await recoverAddress({ hash: maintenanceDigest(env.job), signature });
  if (getAddress(recovered) !== getAddress(signerAddress)) throw new Error("maintenance signature self-check failed");
  return { ...env, signature };
}

export async function assertSignedMaintenanceEnvelope(
  env: SignedMaintenanceEnvelope,
  policy: AuthorizerPolicy & { expectedSigner: Address },
  nowSec: bigint,
): Promise<void> {
  assertMaintenanceEnvelope(env, {
    gateway: policy.gateway,
    chainId: policy.chainId,
    nowSec,
  });
  const recovered = await recoverAddress({ hash: maintenanceDigest(env.job), signature: env.signature });
  if (getAddress(recovered) !== getAddress(policy.expectedSigner)) {
    throw new Error("maintenance envelope signer mismatch");
  }
}

const wallSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Dumb delivery path: validate exact signed envelope, optionally delay B, skip
 * already-consumed jobs before transaction signing, simulate exact calldata,
 * then submit. A post-send unknown receipt is ambiguous and must not be blindly
 * retried by the same relay.
 */
export async function relayMaintenanceEnvelope(
  env: SignedMaintenanceEnvelope,
  chain: RelayChain,
  policy: RelayPolicy,
  opts?: { sleep?: (ms: number) => Promise<void> },
): Promise<RelayResult> {
  const sleep = opts?.sleep ?? wallSleep;
  if ((policy.delayMs ?? 0) > 0) await sleep(policy.delayMs!);

  const nowSec = await chain.nowSec();
  await assertSignedMaintenanceEnvelope(env, policy, nowSec);
  if (await chain.usedJob(policy.gateway, env.job.jobId)) {
    return { status: "already-used", jobId: env.job.jobId, relay: policy.relayLabel };
  }

  const data = encodeRelayCalldata(env);
  try {
    await chain.simulate({ to: policy.gateway, data });
  } catch (e) {
    if (await chain.usedJob(policy.gateway, env.job.jobId).catch(() => false)) {
      return { status: "replay", jobId: env.job.jobId, relay: policy.relayLabel };
    }
    return { status: "failed", jobId: env.job.jobId, relay: policy.relayLabel, error: `preflight: ${String(e)}` };
  }

  let txHash: Hex | undefined;
  try {
    txHash = await chain.send({ to: policy.gateway, data });
  } catch (e) {
    if (await chain.usedJob(policy.gateway, env.job.jobId).catch(() => false)) {
      return { status: "replay", jobId: env.job.jobId, relay: policy.relayLabel };
    }
    return { status: "failed", jobId: env.job.jobId, relay: policy.relayLabel, error: `broadcast: ${String(e)}` };
  }

  const receipt = await chain.receipt(txHash).catch(() => null);
  if (!receipt) return { status: "ambiguous", txHash, jobId: env.job.jobId, relay: policy.relayLabel };
  if (receipt.status === "success") return { status: "consumed", txHash, jobId: env.job.jobId, relay: policy.relayLabel };
  if (await chain.usedJob(policy.gateway, env.job.jobId).catch(() => false)) {
    return { status: "replay", txHash, jobId: env.job.jobId, relay: policy.relayLabel };
  }
  return { status: "failed", txHash, jobId: env.job.jobId, relay: policy.relayLabel, error: "transaction reverted" };
}

export function assertManagedRelayProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  const prod = (env.REACTOR_ENV ?? "").toUpperCase() === "PROD" || env.NODE_ENV === "production";
  if (!prod) return;
  for (const name of ["JOB_SIGNER_PRIVATE_KEY", "KEEPER_PRIVATE_KEY", "RELAYER_PRIVATE_KEY"]) {
    if (env[name]) throw new Error(`${name} forbidden in managed-relay production`);
  }
  const keys = [env.MAINTENANCE_KMS_KEY_ID, env.RELAY_A_KMS_KEY_ID, env.RELAY_B_KMS_KEY_ID];
  if (keys.some((x) => !x)) throw new Error("managed-relay production requires maintenance + relay A + relay B KMS key ids");
  if (new Set(keys).size !== keys.length) throw new Error("managed-relay KMS keys must be distinct");
  if (!env.MAINTENANCE_GATEWAY_ADDRESS || !env.MAINTENANCE_JOB_SIGNER_ADDRESS) {
    throw new Error("managed-relay production requires expected Gateway + maintenance signer address");
  }
}
