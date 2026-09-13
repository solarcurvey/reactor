import {
  keccak256,
  encodeAbiParameters,
  encodePacked,
  toBytes,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from "viem";

export const MAINTENANCE_JOB_NAME = "REACTOR.AutomationGateway";
export const MAINTENANCE_JOB_VERSION = "1";
export const MAINTENANCE_JOB_TTL_SEC = 30 * 60;
export const MAINTENANCE_JOB_TYPESTRING =
  "MaintenanceJob(address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash)";
export const MAINTENANCE_JOB_TYPEHASH = keccak256(toBytes(MAINTENANCE_JOB_TYPESTRING));
export const HOPS_SEED = keccak256(toBytes("REACTOR.MaintenanceHops.v1"));

export const ACTION_SELF_BURN = 0;
export const ACTION_SETTLE_QUOTE = 1;
export const ACTION_SUBMIT_EPOCH = 2;
export const ACTION_TOP10_BUYBACK = 3;
export const ACTION_ROLL_EPOCH = 4;
export const ACTION_BUYBACK = 5;

export const MAINTENANCE_JOB_TYPES = {
  MaintenanceJob: [
    { name: "gateway", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "action", type: "uint8" },
    { name: "payloadHash", type: "bytes32" },
    { name: "jobId", type: "bytes32" },
    { name: "validAfter", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "snapshotHash", type: "bytes32" },
  ],
} as const;

export type MaintenanceHop = {
  adapter: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  minOut: bigint;
  data: Hex;
};

export type MaintenanceJob = {
  gateway: `0x${string}`;
  chainId: bigint;
  action: number;
  payloadHash: Hex;
  jobId: Hex;
  validAfter: bigint;
  deadline: bigint;
  snapshotHash: Hex;
};

export function maintenanceDomain(chainId: bigint, gateway: `0x${string}`) {
  return {
    name: MAINTENANCE_JOB_NAME,
    version: MAINTENANCE_JOB_VERSION,
    chainId,
    verifyingContract: gateway,
  } as const;
}

export function maintenanceDomainSeparator(chainId: bigint, gateway: `0x${string}`): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(toBytes(MAINTENANCE_JOB_NAME)),
        keccak256(toBytes(MAINTENANCE_JOB_VERSION)),
        chainId,
        gateway,
      ],
    ),
  );
}

export function hashHops(hops: MaintenanceHop[]): Hex {
  let acc = HOPS_SEED;
  for (const h of hops) {
    acc = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
          { type: "bytes32" },
        ],
        [acc, h.adapter, h.tokenIn, h.tokenOut, h.minOut, keccak256(h.data)],
      ),
    );
  }
  return acc;
}

export function selfBurnPayload(token: `0x${string}`, amount: bigint, minTargetOut: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [token, amount, minTargetOut],
    ),
  );
}

export function settlePayload(quote: `0x${string}`, amount: bigint, minOut: bigint, hopsHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [quote, amount, minOut, hopsHash],
    ),
  );
}

export function top10Payload(token: `0x${string}`, amount: bigint, minTargetOut: bigint, hopsHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [token, amount, minTargetOut, hopsHash],
    ),
  );
}

export function buybackPayload(quote: `0x${string}`, amount: bigint, minOut: bigint, hopsHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [quote, amount, minOut, hopsHash],
    ),
  );
}

export function rollPayload(epochId: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }], [epochId]));
}

export function epochSnapshotHash(
  epochId: bigint,
  targets: `0x${string}`[],
  weights: bigint[],
  valuationSnapshot: Hex,
  pricingHealthHash: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [
        epochId,
        keccak256(encodeAbiParameters([{ type: "address[]" }], [targets])),
        keccak256(encodeAbiParameters([{ type: "uint256[]" }], [weights])),
        valuationSnapshot,
        pricingHealthHash,
      ],
    ),
  );
}

/** Offchain ValuationService snapshot id. Relayers cannot substitute this. */
export function valuationSnapshotHash(p: {
  source: string;
  computedTs: number;
  pauseEpoch: boolean;
  rows: Array<{ token: string; weightBps: number }>;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "bool" }, { type: "bytes32" }],
      [
        p.source,
        BigInt(p.computedTs),
        p.pauseEpoch,
        keccak256(
          encodeAbiParameters(
            [{ type: "address[]" }, { type: "uint256[]" }],
            [
              p.rows.map((r) => r.token as `0x${string}`),
              p.rows.map((r) => BigInt(r.weightBps)),
            ],
          ),
        ),
      ],
    ),
  );
}

export function pricingHealthHash(health: unknown): Hex {
  return keccak256(toBytes(JSON.stringify(health ?? {})));
}

export function jobIdFromOp(id: string): Hex {
  return keccak256(toBytes(id));
}

export function maintenanceJobDigest(domain: Hex, job: MaintenanceJob): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        MAINTENANCE_JOB_TYPEHASH,
        job.gateway,
        job.chainId,
        job.action,
        job.payloadHash,
        job.jobId,
        job.validAfter,
        job.deadline,
        job.snapshotHash,
      ],
    ),
  );
  return keccak256(encodePacked(["string", "bytes32", "bytes32"], ["\x19\x01", domain, structHash]));
}

export function makeJob(p: {
  gateway: `0x${string}`;
  chainId: bigint;
  action: number;
  payloadHash: Hex;
  jobId: Hex;
  nowSec: bigint;
  ttlSec?: number;
  snapshotHash: Hex;
}): MaintenanceJob {
  const ttl = BigInt(p.ttlSec ?? 15 * 60);
  if (ttl <= 0n || ttl > BigInt(MAINTENANCE_JOB_TTL_SEC)) {
    throw new Error("MaintenanceJob signed window must be (0, 30m]");
  }
  return {
    gateway: p.gateway,
    chainId: p.chainId,
    action: p.action,
    payloadHash: p.payloadHash,
    jobId: p.jobId,
    validAfter: p.nowSec,
    deadline: p.nowSec + ttl,
    snapshotHash: p.snapshotHash,
  };
}

const hopTuple = "(address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[]";

export const automationGatewayAbi = parseAbi([
  `function executeSelfBurn((address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash) job, bytes sig, address token, uint256 amount, uint256 minTargetOut) returns (uint256)`,
  `function settleQuote((address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash) job, bytes sig, address quote, uint256 amount, ${hopTuple} hops, uint256 minOut) returns (uint256)`,
  `function submitEpoch((address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash) job, bytes sig, uint256 epochId, address[] targets, uint256[] weights, bytes32 valuationSnapshot, bytes32 pricingHealthHash)`,
  `function executeTop10Buyback((address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash) job, bytes sig, address token, uint256 amount, ${hopTuple} hops, uint256 minTargetOut) returns (uint256)`,
  `function rollEpoch((address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash) job, bytes sig, uint256 epochId)`,
  `function executeBuyback((address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash) job, bytes sig, address quote, uint256 amount, ${hopTuple} hops, uint256 minOut) returns (uint256)`,
  "function onReport(bytes metadata, bytes report)",
  "function jobSigner() view returns (address)",
  "function paused() view returns (bool)",
  "function usedJob(bytes32) view returns (bool)",
]);

export function encodeSelfBurnCall(job: MaintenanceJob, sig: Hex, token: `0x${string}`, amount: bigint, minTargetOut: bigint): Hex {
  return encodeFunctionData({
    abi: automationGatewayAbi,
    functionName: "executeSelfBurn",
    args: [job, sig, token, amount, minTargetOut],
  });
}

export function encodeSettleCall(
  job: MaintenanceJob,
  sig: Hex,
  quote: `0x${string}`,
  amount: bigint,
  hops: MaintenanceHop[],
  minOut: bigint,
): Hex {
  return encodeFunctionData({
    abi: automationGatewayAbi,
    functionName: "settleQuote",
    args: [job, sig, quote, amount, hops, minOut],
  });
}

export function encodeSubmitEpochCall(
  job: MaintenanceJob,
  sig: Hex,
  epochId: bigint,
  targets: `0x${string}`[],
  weights: bigint[],
  valuationSnapshot: Hex,
  pricingHealthHash: Hex,
): Hex {
  return encodeFunctionData({
    abi: automationGatewayAbi,
    functionName: "submitEpoch",
    args: [job, sig, epochId, targets, weights, valuationSnapshot, pricingHealthHash],
  });
}

export function encodeTop10Call(
  job: MaintenanceJob,
  sig: Hex,
  token: `0x${string}`,
  amount: bigint,
  hops: MaintenanceHop[],
  minTargetOut: bigint,
): Hex {
  return encodeFunctionData({
    abi: automationGatewayAbi,
    functionName: "executeTop10Buyback",
    args: [job, sig, token, amount, hops, minTargetOut],
  });
}

export function encodeRollCall(job: MaintenanceJob, sig: Hex, epochId: bigint): Hex {
  return encodeFunctionData({
    abi: automationGatewayAbi,
    functionName: "rollEpoch",
    args: [job, sig, epochId],
  });
}

export function encodeBuybackCall(
  job: MaintenanceJob,
  sig: Hex,
  quote: `0x${string}`,
  amount: bigint,
  hops: MaintenanceHop[],
  minOut: bigint,
): Hex {
  return encodeFunctionData({
    abi: automationGatewayAbi,
    functionName: "executeBuyback",
    args: [job, sig, quote, amount, hops, minOut],
  });
}

/** CRE / any courier report: same job, no target.call. */
export function encodeMaintenanceReport(job: MaintenanceJob, sig: Hex, args: Hex): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "gateway", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "action", type: "uint8" },
          { name: "payloadHash", type: "bytes32" },
          { name: "jobId", type: "bytes32" },
          { name: "validAfter", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "snapshotHash", type: "bytes32" },
        ],
      },
      { type: "bytes" },
      { type: "bytes" },
    ],
    [job, sig, args],
  );
}
