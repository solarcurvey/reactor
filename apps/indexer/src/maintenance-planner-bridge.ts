import { decodeFunctionData, type Hex } from "viem";
import {
  automationGatewayAbi,
  type MaintenanceHop,
  type MaintenanceJob,
} from "../../../packages/reactor/src/maintenance-job.ts";
import {
  assertMaintenanceEnvelope,
  type UnsignedMaintenanceEnvelope,
} from "../../../packages/reactor/src/maintenance-envelope.ts";

function jobFromDecoded(value: unknown): MaintenanceJob {
  if (!value || typeof value !== "object") throw new Error("managed planner missing decoded MaintenanceJob");
  const v = value as Record<string, unknown>;
  const job: MaintenanceJob = {
    gateway: String(v.gateway) as `0x${string}`,
    chainId: BigInt(v.chainId as bigint),
    action: Number(v.action),
    payloadHash: String(v.payloadHash) as Hex,
    jobId: String(v.jobId) as Hex,
    validAfter: BigInt(v.validAfter as bigint),
    deadline: BigInt(v.deadline as bigint),
    snapshotHash: String(v.snapshotHash) as Hex,
  };
  return job;
}

function hopsFromDecoded(value: unknown): MaintenanceHop[] {
  if (!Array.isArray(value)) throw new Error("managed planner missing decoded hops");
  return value.map((raw) => {
    const h = raw as Record<string, unknown>;
    return {
      adapter: String(h.adapter) as `0x${string}`,
      tokenIn: String(h.tokenIn) as `0x${string}`,
      tokenOut: String(h.tokenOut) as `0x${string}`,
      minOut: BigInt(h.minOut as bigint),
      data: String(h.data) as Hex,
    };
  });
}

/**
 * Decode the exact typed AutomationGateway calldata already produced by the
 * deterministic Keeper planner into the canonical unsigned courier envelope.
 *
 * The planner uses an empty placeholder signature in MANAGED_QUEUE mode. This
 * decoder intentionally discards the signature bytes and then recomputes the
 * action/payload/snapshot binding with assertMaintenanceEnvelope before the job
 * may enter the durable authorizer queue.
 */
export function unsignedEnvelopeFromGatewayCalldata(data: Hex): UnsignedMaintenanceEnvelope {
  const decoded = decodeFunctionData({ abi: automationGatewayAbi, data });
  const args = decoded.args as readonly unknown[];
  const job = jobFromDecoded(args[0]);
  let env: UnsignedMaintenanceEnvelope;

  switch (decoded.functionName) {
    case "executeSelfBurn":
      env = {
        kind: "selfBurn",
        job,
        token: String(args[2]) as `0x${string}`,
        amount: BigInt(args[3] as bigint),
        minOut: BigInt(args[4] as bigint),
      };
      break;
    case "settleQuote":
      env = {
        kind: "settleQuote",
        job,
        quote: String(args[2]) as `0x${string}`,
        amount: BigInt(args[3] as bigint),
        hops: hopsFromDecoded(args[4]),
        minOut: BigInt(args[5] as bigint),
      };
      break;
    case "submitEpoch":
      env = {
        kind: "submitEpoch",
        job,
        epochId: BigInt(args[2] as bigint),
        targets: [...(args[3] as readonly `0x${string}`[])],
        weights: [...(args[4] as readonly bigint[])].map(BigInt),
        valuationSnapshot: String(args[5]) as Hex,
        pricingHealthHash: String(args[6]) as Hex,
      };
      break;
    case "executeTop10Buyback":
      env = {
        kind: "top10",
        job,
        token: String(args[2]) as `0x${string}`,
        amount: BigInt(args[3] as bigint),
        hops: hopsFromDecoded(args[4]),
        minOut: BigInt(args[5] as bigint),
      };
      break;
    case "rollEpoch":
      env = {
        kind: "rollEpoch",
        job,
        epochId: BigInt(args[2] as bigint),
      };
      break;
    case "executeBuyback":
      env = {
        kind: "buyback",
        job,
        quote: String(args[2]) as `0x${string}`,
        amount: BigInt(args[3] as bigint),
        hops: hopsFromDecoded(args[4]),
        minOut: BigInt(args[5] as bigint),
      };
      break;
    default:
      throw new Error(`managed planner refuses non-maintenance Gateway call ${decoded.functionName}`);
  }

  assertMaintenanceEnvelope(env, { requireLiveWindow: false });
  return env;
}
