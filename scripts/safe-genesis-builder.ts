#!/usr/bin/env npx tsx
/**
 * Safe Transaction Builder JSON for REACTOR genesis.
 * Deployer ≠ Guardian Safe. Execute Batch A, verify, then Batch B.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, parseAbi } from "viem";

const chainId = process.env.SAFE_CHAIN_ID ?? "5042002";
const safe = (process.env.EXPECTED_SAFE ?? "0x0000000000000000000000000000000000000001").toLowerCase();
const deployer = (process.env.DEPLOYER ?? "0x0000000000000000000000000000000000000002").toLowerCase();
if (safe === deployer) throw new Error("Safe must not be deployer");

const guardian = process.env.GUARDIAN_CONTRACT as `0x${string}`;
const registry = process.env.REGISTRY as `0x${string}`;
const factory = process.env.FACTORY as `0x${string}`;
const usdc = process.env.USDC as `0x${string}`;
const pricing = process.env.EXPECTED_PRICING_SIGNER as `0x${string}`;
const launch = (process.env.EXPECTED_LAUNCH_SIGNER ?? pricing) as `0x${string}`;
const tickers = process.env.TICKER_REGISTRY as `0x${string}`;
const vesting = process.env.VESTING as `0x${string}`;

function tx(to: string | undefined, abi: readonly unknown[], fn: string, args: unknown[], name: string) {
  if (!to) throw new Error(`missing address for ${name}`);
  return {
    to,
    value: "0",
    data: encodeFunctionData({ abi: abi as never, functionName: fn as never, args: args as never }),
    contractMethod: { name: fn, payable: false },
    contractInputsValues: Object.fromEntries((args as unknown[]).map((v, i) => [`arg${i}`, String(v)])),
    meta: { name },
  };
}

const gAbi = parseAbi([
  "function setPricingSigner(address)",
  "function setLaunchSigner(address)",
  "function bindTickerRegistry(address)",
  "function authorizeFactory(address,uint32)",
  "function pauseLaunches(bool)",
]);
const rAbi = parseAbi(["function setUsdc(address)"]);
const vAbi = parseAbi(["function activateLaunch()"]);

const batchA = [
  tx(guardian, gAbi, "setPricingSigner", [pricing], "setPricingSigner"),
  tx(guardian, gAbi, "setLaunchSigner", [launch], "setLaunchSigner"),
  tx(guardian, gAbi, "bindTickerRegistry", [tickers], "bindTickerRegistry"),
  tx(guardian, gAbi, "authorizeFactory", [factory, 1], "authorizeFactory V1"),
  tx(registry, rAbi, "setUsdc", [usdc], "setUsdc"),
];

const batchB = [
  tx(vesting, vAbi, "activateLaunch", [], "activateLaunch"),
  tx(guardian, gAbi, "pauseLaunches", [false], "pauseLaunches(false) LAST"),
];

const out = {
  version: "1.0",
  chainId,
  createdAt: Date.now(),
  meta: {
    name: "REACTOR Safe Genesis",
    description: "Deployer ≠ Guardian. Batch A while paused, verify, then Batch B T0.",
    txBuilderVersion: "1.16.5",
  },
  transactions: [...batchA, ...batchB],
};

const path = join(import.meta.dirname, "..", "deployments", "safe-genesis-builder.json");
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(path);
