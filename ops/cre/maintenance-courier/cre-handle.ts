/**
 * HTTP-trigger body used by official CRE WASM (`main.ts`).
 * Stays inside this package so `cre workflow build` can resolve `viem`.
 */
import { hashBytes, hashReport, creReport, relayCalldata, type MaintenanceHop, type MaintenanceJob } from "./encode";

export type SignedJobHttpPayload = {
  job: {
    gateway: `0x${string}`;
    chainId: string;
    action: number;
    payloadHash: `0x${string}`;
    jobId: `0x${string}`;
    validAfter: string;
    deadline: string;
    snapshotHash: `0x${string}`;
  };
  signature: `0x${string}`;
  kind: "selfBurn" | "settleQuote" | "submitEpoch" | "top10" | "rollEpoch" | "buyback";
  hops?: Array<{
    adapter: `0x${string}`;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    minOut: string;
    data: `0x${string}`;
  }>;
  quote?: `0x${string}`;
  amount?: string;
  minOut?: string;
};

export type CourierSimulationResult = {
  kind: "maintenance-job-courier";
  action: number;
  jobId: `0x${string}`;
  jobChainId: string;
  relayCalldata: `0x${string}`;
  relayCalldataHash: `0x${string}`;
  creOnReport: `0x${string}`;
  creOnReportHash: `0x${string}`;
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

export function handleSignedJobPayload(input: SignedJobHttpPayload): CourierSimulationResult {
  if (input.kind !== "settleQuote") {
    throw new Error("simulation courier ships settleQuote; other actions use the same signed job + typed encode*");
  }
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
  const env = {
    job,
    signature: input.signature,
    kind: input.kind,
    hops: (input.hops ?? []).map(asHop),
    quote: input.quote,
    amount: input.amount === undefined ? undefined : BigInt(input.amount),
    minOut: input.minOut === undefined ? undefined : BigInt(input.minOut),
  };
  const relay = relayCalldata(env);
  const report = creReport(env);
  return {
    kind: "maintenance-job-courier",
    action: env.job.action,
    jobId: env.job.jobId,
    jobChainId: env.job.chainId.toString(),
    relayCalldata: relay,
    relayCalldataHash: hashBytes(relay),
    creOnReport: report,
    creOnReportHash: hashReport(report),
    rebuiltMinOut: false,
    rebuiltTargets: false,
    broadcast: false,
  };
}
