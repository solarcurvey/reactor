/**
 * Node/CI HTTP-trigger courier body (`scripts/cre-workflow-simulate.ts`).
 * Official CRE WASM (`main.ts`) uses `cre-handle.ts` → `encode.ts` so
 * `cre workflow build` can resolve `viem` inside this package. Both paths
 * must produce the same calldata hashes. Never rebuilds hops, minOut, amount,
 * or Top-10 targets.
 */
import { keccak256, toBytes, type Hex } from "viem";
import {
  creReport,
  relayCalldata,
  type SignedMaintenanceEnvelope,
} from "../workflow.ts";
import type { MaintenanceHop, MaintenanceJob } from "../../../packages/reactor/src/maintenance-job.ts";

export type SignedJobHttpPayload = {
  job: {
    gateway: `0x${string}`;
    chainId: string;
    action: number;
    payloadHash: Hex;
    jobId: Hex;
    validAfter: string;
    deadline: string;
    snapshotHash: Hex;
  };
  signature: Hex;
  kind: SignedMaintenanceEnvelope["kind"];
  hops?: Array<{
    adapter: `0x${string}`;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    minOut: string;
    data: Hex;
  }>;
  quote?: `0x${string}`;
  amount?: string;
  minOut?: string;
};

export type CourierSimulationResult = {
  kind: "maintenance-job-courier";
  action: number;
  jobId: Hex;
  jobChainId: string;
  relayCalldata: Hex;
  relayCalldataHash: Hex;
  creOnReport: Hex;
  creOnReportHash: Hex;
  rebuiltMinOut: false;
  rebuiltTargets: false;
  broadcast: false;
};

function asHop(h: NonNullable<SignedJobHttpPayload["hops"]>[number]): MaintenanceHop {
  return {
    adapter: h.adapter,
    tokenIn: h.tokenIn,
    tokenOut: h.tokenOut,
    minOut: BigInt(h.minOut),
    data: h.data,
  };
}

export function envelopeFromHttpPayload(input: SignedJobHttpPayload): SignedMaintenanceEnvelope {
  const job: MaintenanceJob = {
    gateway: input.job.gateway,
    chainId: BigInt(input.job.chainId),
    action: input.job.action,
    payloadHash: input.job.payloadHash,
    jobId: input.job.jobId,
    validAfter: BigInt(input.job.validAfter),
    deadline: BigInt(input.job.deadline),
    snapshotHash: input.job.snapshotHash,
  };
  return {
    job,
    signature: input.signature,
    kind: input.kind,
    hops: (input.hops ?? []).map(asHop),
    quote: input.quote,
    amount: input.amount === undefined ? undefined : BigInt(input.amount),
    minOut: input.minOut === undefined ? undefined : BigInt(input.minOut),
  };
}

export function handleSignedJobPayload(input: SignedJobHttpPayload): CourierSimulationResult {
  if (input.kind !== "settleQuote") {
    throw new Error("simulation courier ships settleQuote; other actions use the same signed job + typed encode*");
  }
  const env = envelopeFromHttpPayload(input);
  const relay = relayCalldata(env);
  const report = creReport(env);
  return {
    kind: "maintenance-job-courier",
    action: env.job.action,
    jobId: env.job.jobId,
    jobChainId: env.job.chainId.toString(),
    relayCalldata: relay,
    relayCalldataHash: keccak256(toBytes(relay)),
    creOnReport: report,
    creOnReportHash: keccak256(report),
    rebuiltMinOut: false,
    rebuiltTargets: false,
    broadcast: false,
  };
}
