/**
 * Self-contained settleQuote encode for official `cre workflow build`.
 *
 * CRE's TypeScript compiler only resolves packages from this workflow folder.
 * Do not import `../workflow.ts` or `packages/reactor` from the WASM graph.
 * Node/CI still uses `handle-signed-job.ts` → `../workflow.ts` → `@reactor/core`.
 *
 * Same typed MaintenanceJob bytes as the daemon. Courier only. Not a ranker.
 */
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toBytes,
  type Hex,
} from "viem";

const hopTuple = "(address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[]";

const automationGatewayAbi = parseAbi([
  `function settleQuote((address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash) job, bytes sig, address quote, uint256 amount, ${hopTuple} hops, uint256 minOut) returns (uint256)`,
]);

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

export type SignedMaintenanceEnvelope = {
  job: MaintenanceJob;
  signature: Hex;
  kind: "selfBurn" | "settleQuote" | "submitEpoch" | "top10" | "rollEpoch" | "buyback";
  hops?: MaintenanceHop[];
  quote?: `0x${string}`;
  amount?: bigint;
  minOut?: bigint;
};

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

export function relayCalldata(env: SignedMaintenanceEnvelope): Hex {
  if (env.kind !== "settleQuote" || !env.quote || env.amount === undefined || env.minOut === undefined) {
    throw new Error("PoC workflow ships settleQuote; other kinds use the same signed job + typed encode* helpers");
  }
  return encodeSettleCall(env.job, env.signature, env.quote, env.amount, env.hops ?? [], env.minOut);
}

export function creReport(env: SignedMaintenanceEnvelope): Hex {
  if (env.kind !== "settleQuote" || !env.quote || env.amount === undefined || env.minOut === undefined) {
    throw new Error("PoC report is settleQuote");
  }
  const args = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      {
        type: "tuple[]",
        components: [
          { name: "adapter", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "minOut", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
      { type: "uint256" },
    ],
    [env.quote, env.amount, env.hops ?? [], env.minOut],
  );
  return encodeMaintenanceReport(env.job, env.signature, args);
}

export function hashBytes(value: Hex): Hex {
  return keccak256(toBytes(value));
}

export function hashReport(value: Hex): Hex {
  return keccak256(value);
}
