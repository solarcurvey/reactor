import { type Hex } from "viem";
import {
  ACTION_BUYBACK,
  ACTION_ROLL_EPOCH,
  ACTION_SELF_BURN,
  ACTION_SETTLE_QUOTE,
  ACTION_SUBMIT_EPOCH,
  ACTION_TOP10_BUYBACK,
  MAINTENANCE_JOB_TTL_SEC,
  buybackPayload,
  encodeBuybackCall,
  encodeRollCall,
  encodeSelfBurnCall,
  encodeSettleCall,
  encodeSubmitEpochCall,
  encodeTop10Call,
  epochSnapshotHash,
  hashHops,
  rollPayload,
  selfBurnPayload,
  settlePayload,
  top10Payload,
  type MaintenanceHop,
  type MaintenanceJob,
} from "./maintenance-job.ts";

export type MaintenanceKind = "selfBurn" | "settleQuote" | "submitEpoch" | "top10" | "rollEpoch" | "buyback";

export type UnsignedMaintenanceEnvelope = {
  job: MaintenanceJob;
  kind: MaintenanceKind;
  hops?: MaintenanceHop[];
  token?: `0x${string}`;
  quote?: `0x${string}`;
  amount?: bigint;
  minOut?: bigint;
  epochId?: bigint;
  targets?: `0x${string}`[];
  weights?: bigint[];
  valuationSnapshot?: Hex;
  pricingHealthHash?: Hex;
};

export type SignedMaintenanceEnvelope = UnsignedMaintenanceEnvelope & { signature: Hex };

export type MaintenanceEnvelopeValidation = {
  gateway?: `0x${string}`;
  chainId?: bigint;
  nowSec?: bigint;
  requireLiveWindow?: boolean;
};

export const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null) throw new Error(`maintenance envelope missing ${name}`);
  return value;
}

function expectedAction(kind: MaintenanceKind): number {
  switch (kind) {
    case "selfBurn": return ACTION_SELF_BURN;
    case "settleQuote": return ACTION_SETTLE_QUOTE;
    case "submitEpoch": return ACTION_SUBMIT_EPOCH;
    case "top10": return ACTION_TOP10_BUYBACK;
    case "rollEpoch": return ACTION_ROLL_EPOCH;
    case "buyback": return ACTION_BUYBACK;
  }
}

export function maintenanceEnvelopeBinding(env: UnsignedMaintenanceEnvelope): { payloadHash: Hex; snapshotHash: Hex } {
  switch (env.kind) {
    case "selfBurn": {
      const token = need(env.token, "token");
      const amount = need(env.amount, "amount");
      const minOut = need(env.minOut, "minOut");
      return { payloadHash: selfBurnPayload(token, amount, minOut), snapshotHash: ZERO32 };
    }
    case "settleQuote": {
      const quote = need(env.quote, "quote");
      const amount = need(env.amount, "amount");
      const minOut = need(env.minOut, "minOut");
      const hopsHash = hashHops(env.hops ?? []);
      return { payloadHash: settlePayload(quote, amount, minOut, hopsHash), snapshotHash: hopsHash };
    }
    case "submitEpoch": {
      const epochId = need(env.epochId, "epochId");
      const targets = need(env.targets, "targets");
      const weights = need(env.weights, "weights");
      const valuationSnapshot = need(env.valuationSnapshot, "valuationSnapshot");
      const pricing = need(env.pricingHealthHash, "pricingHealthHash");
      if (targets.length !== weights.length || targets.length === 0) throw new Error("maintenance epoch target/weight shape invalid");
      const snap = epochSnapshotHash(epochId, targets, weights, valuationSnapshot, pricing);
      return { payloadHash: snap, snapshotHash: snap };
    }
    case "top10": {
      const token = need(env.token, "token");
      const amount = need(env.amount, "amount");
      const minOut = need(env.minOut, "minOut");
      const hopsHash = hashHops(env.hops ?? []);
      return { payloadHash: top10Payload(token, amount, minOut, hopsHash), snapshotHash: hopsHash };
    }
    case "rollEpoch": {
      const payload = rollPayload(need(env.epochId, "epochId"));
      return { payloadHash: payload, snapshotHash: payload };
    }
    case "buyback": {
      const quote = need(env.quote, "quote");
      const amount = need(env.amount, "amount");
      const minOut = need(env.minOut, "minOut");
      const hopsHash = hashHops(env.hops ?? []);
      return { payloadHash: buybackPayload(quote, amount, minOut, hopsHash), snapshotHash: hopsHash };
    }
  }
}

export function assertMaintenanceEnvelope(env: UnsignedMaintenanceEnvelope, opts: MaintenanceEnvelopeValidation = {}): void {
  if (env.job.action !== expectedAction(env.kind)) throw new Error("maintenance envelope action/kind mismatch");
  if (env.job.deadline <= env.job.validAfter) throw new Error("maintenance envelope validity window invalid");
  if (env.job.deadline - env.job.validAfter > BigInt(MAINTENANCE_JOB_TTL_SEC)) throw new Error("maintenance envelope window exceeds 30m");
  if (opts.gateway && !sameHex(env.job.gateway, opts.gateway)) throw new Error("maintenance envelope wrong gateway");
  if (opts.chainId !== undefined && env.job.chainId !== opts.chainId) throw new Error("maintenance envelope wrong chain");
  if (opts.requireLiveWindow !== false && opts.nowSec !== undefined) {
    if (opts.nowSec < env.job.validAfter) throw new Error("maintenance envelope too early");
    if (opts.nowSec > env.job.deadline) throw new Error("maintenance envelope expired");
  }
  const expected = maintenanceEnvelopeBinding(env);
  if (!sameHex(env.job.payloadHash, expected.payloadHash)) throw new Error("maintenance envelope payloadHash mismatch");
  if (!sameHex(env.job.snapshotHash, expected.snapshotHash)) throw new Error("maintenance envelope snapshotHash mismatch");
}

export function encodeRelayCalldata(env: SignedMaintenanceEnvelope): Hex {
  assertMaintenanceEnvelope(env, { requireLiveWindow: false });
  switch (env.kind) {
    case "selfBurn":
      return encodeSelfBurnCall(env.job, env.signature, need(env.token, "token"), need(env.amount, "amount"), need(env.minOut, "minOut"));
    case "settleQuote":
      return encodeSettleCall(env.job, env.signature, need(env.quote, "quote"), need(env.amount, "amount"), env.hops ?? [], need(env.minOut, "minOut"));
    case "submitEpoch":
      return encodeSubmitEpochCall(
        env.job,
        env.signature,
        need(env.epochId, "epochId"),
        need(env.targets, "targets"),
        need(env.weights, "weights"),
        need(env.valuationSnapshot, "valuationSnapshot"),
        need(env.pricingHealthHash, "pricingHealthHash"),
      );
    case "top10":
      return encodeTop10Call(env.job, env.signature, need(env.token, "token"), need(env.amount, "amount"), env.hops ?? [], need(env.minOut, "minOut"));
    case "rollEpoch":
      return encodeRollCall(env.job, env.signature, need(env.epochId, "epochId"));
    case "buyback":
      return encodeBuybackCall(env.job, env.signature, need(env.quote, "quote"), need(env.amount, "amount"), env.hops ?? [], need(env.minOut, "minOut"));
  }
}

function bigintString(value: unknown, name: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`maintenance envelope invalid ${name}`);
}

function hex(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) throw new Error(`maintenance envelope invalid ${name}`);
  return value as Hex;
}

function address(value: unknown, name: string): `0x${string}` {
  const out = hex(value, name);
  if (out.length !== 42) throw new Error(`maintenance envelope invalid ${name}`);
  return out as `0x${string}`;
}

export function maintenanceEnvelopeFromJson(raw: unknown, signed = true): UnsignedMaintenanceEnvelope | SignedMaintenanceEnvelope {
  if (!raw || typeof raw !== "object") throw new Error("maintenance envelope invalid json");
  const r = raw as Record<string, unknown>;
  const j = r.job as Record<string, unknown> | undefined;
  if (!j) throw new Error("maintenance envelope missing job");
  const kind = String(r.kind ?? "") as MaintenanceKind;
  if (!["selfBurn", "settleQuote", "submitEpoch", "top10", "rollEpoch", "buyback"].includes(kind)) {
    throw new Error("maintenance envelope invalid kind");
  }
  const hops = Array.isArray(r.hops)
    ? r.hops.map((h, i) => {
        const x = h as Record<string, unknown>;
        return {
          adapter: address(x.adapter, `hops[${i}].adapter`),
          tokenIn: address(x.tokenIn, `hops[${i}].tokenIn`),
          tokenOut: address(x.tokenOut, `hops[${i}].tokenOut`),
          minOut: bigintString(x.minOut, `hops[${i}].minOut`),
          data: hex(x.data ?? "0x", `hops[${i}].data`),
        } satisfies MaintenanceHop;
      })
    : undefined;
  const out: UnsignedMaintenanceEnvelope = {
    kind,
    job: {
      gateway: address(j.gateway, "job.gateway"),
      chainId: bigintString(j.chainId, "job.chainId"),
      action: Number(j.action),
      payloadHash: hex(j.payloadHash, "job.payloadHash"),
      jobId: hex(j.jobId, "job.jobId"),
      validAfter: bigintString(j.validAfter, "job.validAfter"),
      deadline: bigintString(j.deadline, "job.deadline"),
      snapshotHash: hex(j.snapshotHash, "job.snapshotHash"),
    },
    hops,
    token: r.token === undefined ? undefined : address(r.token, "token"),
    quote: r.quote === undefined ? undefined : address(r.quote, "quote"),
    amount: r.amount === undefined ? undefined : bigintString(r.amount, "amount"),
    minOut: r.minOut === undefined ? undefined : bigintString(r.minOut, "minOut"),
    epochId: r.epochId === undefined ? undefined : bigintString(r.epochId, "epochId"),
    targets: Array.isArray(r.targets) ? r.targets.map((x, i) => address(x, `targets[${i}]`)) : undefined,
    weights: Array.isArray(r.weights) ? r.weights.map((x, i) => bigintString(x, `weights[${i}]`)) : undefined,
    valuationSnapshot: r.valuationSnapshot === undefined ? undefined : hex(r.valuationSnapshot, "valuationSnapshot"),
    pricingHealthHash: r.pricingHealthHash === undefined ? undefined : hex(r.pricingHealthHash, "pricingHealthHash"),
  };
  if (!Number.isInteger(out.job.action) || out.job.action < 0 || out.job.action > 255) throw new Error("maintenance envelope invalid job.action");
  if (!signed) return out;
  return { ...out, signature: hex(r.signature, "signature") };
}

export function maintenanceEnvelopeToJson(env: UnsignedMaintenanceEnvelope | SignedMaintenanceEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = {
    kind: env.kind,
    job: {
      ...env.job,
      chainId: env.job.chainId.toString(),
      validAfter: env.job.validAfter.toString(),
      deadline: env.job.deadline.toString(),
    },
  };
  if ("signature" in env) out.signature = env.signature;
  if (env.hops) out.hops = env.hops.map((h) => ({ ...h, minOut: h.minOut.toString() }));
  if (env.token) out.token = env.token;
  if (env.quote) out.quote = env.quote;
  if (env.amount !== undefined) out.amount = env.amount.toString();
  if (env.minOut !== undefined) out.minOut = env.minOut.toString();
  if (env.epochId !== undefined) out.epochId = env.epochId.toString();
  if (env.targets) out.targets = env.targets;
  if (env.weights) out.weights = env.weights.map(String);
  if (env.valuationSnapshot) out.valuationSnapshot = env.valuationSnapshot;
  if (env.pricingHealthHash) out.pricingHealthHash = env.pricingHealthHash;
  return out;
}
