/**
 * Chainlink CRE courier (TypeScript). Not a ranker.
 *
 * Official CRE project: `ops/cre/maintenance-courier` (`cre workflow simulate`).
 * This file is the same job interface the daemon signs: fetch a pre-signed
 * MaintenanceJob, encode typed delivery, never rebuild targets/minOut.
 *
 * CRE does not decentralize Top-10. Arc Mainnet 5042 production writes are not claimed.
 */
import {
  encodeMaintenanceReport,
  encodeSettleCall,
  type MaintenanceHop,
  type MaintenanceJob,
} from "../../packages/reactor/src/maintenance-job.ts";
import { encodeAbiParameters, type Hex } from "viem";

export type SignedMaintenanceEnvelope = {
  job: MaintenanceJob;
  signature: Hex;
  kind: "selfBurn" | "settleQuote" | "submitEpoch" | "top10" | "rollEpoch" | "buyback";
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

/** Relayer path: typed gateway calldata. CRE/Gelato/EOA all use this. */
export function relayCalldata(env: SignedMaintenanceEnvelope): Hex {
  if (env.kind !== "settleQuote" || !env.quote || env.amount === undefined || env.minOut === undefined) {
    throw new Error("PoC workflow ships settleQuote; other kinds use the same signed job + typed encode* helpers");
  }
  return encodeSettleCall(env.job, env.signature, env.quote, env.amount, env.hops ?? [], env.minOut);
}

/** CRE-native report path: onReport decodes this — still not target.call. */
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

export const CRE_TRUST =
  "CRE / Gelato / any relayer delivers an already-signed MaintenanceJob. Ranking stays ValuationService. Not a trustless oracle. Not Arc Mainnet.";
