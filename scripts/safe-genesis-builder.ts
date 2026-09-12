#!/usr/bin/env npx tsx
/**
 * Safe Transaction Builder JSON + MultiSend from deployment artifacts.
 * Batch A (config while paused) → VerifyGenesis → Batch B (T0 unpause).
 * Local Anvil deployer ≠ Guardian Safe. Do not execute local rehearsal as production.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { concatHex, encodeFunctionData, pad, parseAbi, size, toHex, type Hex } from "viem";

const root = join(import.meta.dirname, "..");
const ANVIL0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const ZERO = "0x0000000000000000000000000000000000000000";
const PLACEHOLDER_SAFE = "0x0000000000000000000000000000000000000001";
/** Canonical Safe MultiSendCallOnly (verify on the target chain before broadcast). */
export const MULTISEND_CALL_ONLY = "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D";

type Addrs = Record<string, string>;

export type BuilderTx = {
  to: string;
  value: string;
  data: Hex;
  contractMethod: { name: string; payable: false; inputs: { name: string; type: string }[] };
  contractInputsValues: Record<string, string>;
  meta: { name: string; batch: "A" | "B" };
};

const gAbi = parseAbi([
  "function setPricingSigner(address next)",
  "function setLaunchSigner(address next)",
  "function bindTickerRegistry(address tickers_)",
  "function authorizeFactory(address factory, uint32 version)",
  "function setAdapter(address adapter, bool approved)",
  "function pauseLaunches(bool paused)",
]);
const rAbi = parseAbi([
  "function setUsdc(address token)",
  "function register(address token, string symbol, string name, uint8 decimals, string icon, uint8 category)",
  "function setUsdPegOne(address token, bool peg)",
  "function setBuybackRoute(address token, bool enabled, bool hopViaUsdc)",
  "function bindFactory(address factory)",
]);
const vAbi = parseAbi(["function activateLaunch()"]);
const hookAbi = parseAbi([
  "function bindCoreVault(address vault)",
  "function bindBuyback(address buyback)",
  "function bindFlywheel(address flywheel)",
  "function bindFactory(address factory)",
  "function bindLaunchModule(address module)",
  "function bindCurve(address curve)",
  "function bindSelfBurn(address vault)",
]);
const coreLpAbi = parseAbi(["function initializeAndLock()"]);
const vaultAbi = parseAbi(["function bindFactory(address factory)", "function bindLaunchModule(address module)"]);
const flywheelAbi = parseAbi(["function bind(address factory)"]);
const buybackAbi = parseAbi(["function bindFactory(address factory)", "function bindExecutor(address executor)"]);
const factoryAbi = parseAbi(["function bindCurve(address curve, address selfBurn)", "function bindLaunchModule(address module)"]);
const routerAbi = parseAbi(["function setProtocolVault(address vault, bool ok)", "function sealProtocolVaults()"]);
const curveAbi = parseAbi(["function bindRouteExecutor(address executor)"]);
const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);

function addr(v?: string): string | undefined {
  if (!v || v === ZERO) return undefined;
  return v.toLowerCase();
}

function tx(
  to: string | undefined,
  abi: readonly unknown[],
  fn: string,
  args: unknown[],
  names: string[],
  batch: "A" | "B",
  label: string,
): BuilderTx {
  if (!to) throw new Error(`missing address for ${label}`);
  return {
    to,
    value: "0",
    data: encodeFunctionData({ abi: abi as never, functionName: fn as never, args: args as never }),
    contractMethod: {
      name: fn,
      payable: false,
      inputs: names.map((name, i) => ({ name, type: typeof args[i] === "boolean" ? "bool" : typeof args[i] === "number" ? "uint32" : "address" })),
    },
    contractInputsValues: Object.fromEntries(names.map((n, i) => [n, String(args[i])])),
    meta: { name: label, batch },
  };
}

export function packMultiSend(txs: BuilderTx[]): Hex {
  return concatHex(
    txs.map((t) =>
      concatHex(["0x00", pad(t.to as Hex, { size: 20 }), pad(toHex(0n), { size: 32 }), pad(toHex(BigInt(size(t.data))), { size: 32 }), t.data]),
    ),
  );
}

export function loadArtifactAddresses(): Addrs {
  const p = join(root, "deployments/local.json");
  if (!existsSync(p)) return {};
  const j = JSON.parse(readFileSync(p, "utf8")) as { addresses?: Addrs; chainId?: number };
  return { ...(j.addresses ?? {}), __chainId: String(j.chainId ?? "") };
}

export function resolveRoles(addrs: Addrs) {
  const deployer = (process.env.DEPLOYER ?? ANVIL0).toLowerCase();
  const safe = (process.env.EXPECTED_SAFE ?? PLACEHOLDER_SAFE).toLowerCase();
  if (safe === deployer) throw new Error("Safe must not be the local deployer");
  const localGuardian = addr(addrs.Guardian);
  const keeper = addr(process.env.EXPECTED_KEEPER ?? addrs.Keeper) ?? deployer;
  const pricing = addr(process.env.EXPECTED_PRICING_SIGNER ?? addrs.PricingSigner);
  const launch = addr(process.env.EXPECTED_LAUNCH_SIGNER ?? addrs.LaunchSigner ?? pricing);
  return { deployer, safe, localGuardian, keeper, pricing, launch };
}

export function buildBatches(addrs: Addrs) {
  const roles = resolveRoles(addrs);
  const guardian = addr(process.env.GUARDIAN_CONTRACT ?? addrs.Guardian);
  const registry = addr(process.env.REGISTRY ?? addrs.QuoteAssetRegistry);
  const factory = addr(process.env.FACTORY ?? addrs.ReactorFactory);
  const usdc = addr(process.env.USDC ?? addrs.USDC);
  const tickers = addr(process.env.TICKER_REGISTRY ?? addrs.TickerRegistry);
  const vesting = addr(process.env.VESTING ?? addrs.CoreVesting);
  const hook = addr(process.env.HOOK ?? addrs.ReactorHook);
  const vault = addr(process.env.VAULT ?? addrs.ReactorLiquidityVault);
  const flywheel = addr(process.env.FLYWHEEL ?? addrs.FlywheelVault);
  const buyback = addr(process.env.BUYBACK ?? addrs.BuybackVault);
  const curve = addr(process.env.CURVE ?? addrs.InstantCurve);
  const selfBurn = addr(process.env.SELF_BURN ?? addrs.SelfBurnVault);
  const userRouter = addr(process.env.USER_ROUTER ?? addrs.UserRouteExecutor);
  const userAdapter = addr(process.env.USER_ADAPTER ?? addrs.V4Adapter ?? addrs.UniswapV4Adapter);
  const protocolAdapter = addr(process.env.PROTOCOL_ADAPTER ?? addrs.ProtocolV4Adapter);
  const coreLp = addr(process.env.CORE_LP ?? addrs.CoreLiquidityVault);
  const coreBuyback = addr(process.env.CORE_BUYBACK ?? addrs.CoreBuybackExecutor);
  const router = addr(process.env.ROUTER ?? addrs.ReactorRouter);
  const launchModule = addr(process.env.LAUNCH_MODULE ?? addrs.InstantLaunchModule);

  if (!guardian || !registry || !factory || !usdc || !vesting) {
    throw new Error("Safe builder needs Guardian, QuoteAssetRegistry, ReactorFactory, USDC, CoreVesting from local.json or env");
  }
  if (!roles.pricing) throw new Error("PricingSigner missing");
  if (roles.pricing === roles.safe || roles.pricing === roles.deployer) {
    /* local dump often reuses Anvil #0 as PricingSigner — rehearsal still requires Safe ≠ deployer */
  }

  const omitted: string[] = [];
  const batchA: BuilderTx[] = [];
  const addA = (label: string, needed: (string | undefined)[], fn: () => BuilderTx) => {
    if (needed.some((n) => !n)) {
      omitted.push(label);
      return;
    }
    batchA.push(fn());
  };

  batchA.push(tx(guardian, gAbi, "setPricingSigner", [roles.pricing], ["next"], "A", "setPricingSigner"));
  batchA.push(tx(guardian, gAbi, "setLaunchSigner", [roles.launch], ["next"], "A", "setLaunchSigner"));
  addA("bindTickerRegistry", [tickers], () =>
    tx(guardian, gAbi, "bindTickerRegistry", [tickers], ["tickers_"], "A", "bindTickerRegistry"),
  );
  addA("authorizeFactory V1", [tickers], () =>
    tx(guardian, gAbi, "authorizeFactory", [factory, 1], ["factory", "version"], "A", "authorizeFactory V1"),
  );
  batchA.push(tx(registry, rAbi, "setUsdc", [usdc], ["token"], "A", "setUsdc"));
  batchA.push(
    tx(registry, rAbi, "register", [usdc, "USDC", "USD Coin", 6, "", 4], ["token", "symbol", "name", "decimals", "icon", "category"], "A", "register USDC"),
  );
  batchA.push(tx(registry, rAbi, "setUsdPegOne", [usdc, true], ["token", "peg"], "A", "setUsdPegOne USDC"));
  batchA.push(tx(registry, rAbi, "setBuybackRoute", [usdc, true, false], ["token", "enabled", "hopViaUsdc"], "A", "setBuybackRoute USDC"));
  addA("bindCoreVault", [hook, coreLp], () => tx(hook, hookAbi, "bindCoreVault", [coreLp], ["vault"], "A", "bindCoreVault"));
  addA("initializeAndLock", [coreLp], () => tx(coreLp, coreLpAbi, "initializeAndLock", [], [], "A", "initializeAndLock"));
  addA("setAdapter user", [userAdapter], () => tx(guardian, gAbi, "setAdapter", [userAdapter, true], ["adapter", "approved"], "A", "setAdapter user"));
  addA("setAdapter protocol", [protocolAdapter], () =>
    tx(guardian, gAbi, "setAdapter", [protocolAdapter, true], ["adapter", "approved"], "A", "setAdapter protocol"),
  );
  addA("bindBuyback", [hook, buyback], () => tx(hook, hookAbi, "bindBuyback", [buyback], ["buyback"], "A", "bindBuyback"));
  addA("bindFlywheel", [hook, flywheel], () => tx(hook, hookAbi, "bindFlywheel", [flywheel], ["flywheel"], "A", "bindFlywheel"));
  addA("hook.bindFactory", [hook], () => tx(hook, hookAbi, "bindFactory", [factory], ["factory"], "A", "hook.bindFactory"));
  addA("hook.bindLaunchModule", [hook, launchModule], () =>
    tx(hook, hookAbi, "bindLaunchModule", [launchModule], ["module"], "A", "hook.bindLaunchModule"),
  );
  addA("vault.bindFactory", [vault], () => tx(vault, vaultAbi, "bindFactory", [factory], ["factory"], "A", "vault.bindFactory"));
  addA("vault.bindLaunchModule", [vault, launchModule], () =>
    tx(vault, vaultAbi, "bindLaunchModule", [launchModule], ["module"], "A", "vault.bindLaunchModule"),
  );
  batchA.push(tx(registry, rAbi, "bindFactory", [factory], ["factory"], "A", "registry.bindFactory"));
  addA("flywheel.bind", [flywheel], () => tx(flywheel, flywheelAbi, "bind", [factory], ["factory"], "A", "flywheel.bind"));
  addA("buyback.bindFactory", [buyback], () => tx(buyback, buybackAbi, "bindFactory", [factory], ["factory"], "A", "buyback.bindFactory"));
  addA("factory.bindCurve", [curve, selfBurn], () =>
    tx(factory, factoryAbi, "bindCurve", [curve, selfBurn], ["curve", "selfBurn"], "A", "factory.bindCurve"),
  );
  addA("factory.bindLaunchModule", [launchModule], () =>
    tx(factory, factoryAbi, "bindLaunchModule", [launchModule], ["module"], "A", "factory.bindLaunchModule"),
  );
  addA("hook.bindCurve", [hook, curve], () => tx(hook, hookAbi, "bindCurve", [curve], ["curve"], "A", "hook.bindCurve"));
  addA("hook.bindSelfBurn", [hook, selfBurn], () => tx(hook, hookAbi, "bindSelfBurn", [selfBurn], ["vault"], "A", "hook.bindSelfBurn"));
  addA("bindExecutor", [buyback, coreBuyback], () =>
    tx(buyback, buybackAbi, "bindExecutor", [coreBuyback], ["executor"], "A", "bindExecutor"),
  );
  addA("setProtocolVault selfBurn", [router, selfBurn], () =>
    tx(router, routerAbi, "setProtocolVault", [selfBurn, true], ["vault", "ok"], "A", "setProtocolVault selfBurn"),
  );
  addA("setProtocolVault flywheel", [router, flywheel], () =>
    tx(router, routerAbi, "setProtocolVault", [flywheel, true], ["vault", "ok"], "A", "setProtocolVault flywheel"),
  );
  addA("setProtocolVault coreBuyback", [router, coreBuyback], () =>
    tx(router, routerAbi, "setProtocolVault", [coreBuyback, true], ["vault", "ok"], "A", "setProtocolVault coreBuyback"),
  );
  addA("setProtocolVault protocolAdapter", [router, protocolAdapter], () =>
    tx(router, routerAbi, "setProtocolVault", [protocolAdapter, true], ["vault", "ok"], "A", "setProtocolVault protocolAdapter"),
  );
  addA("sealProtocolVaults", [router], () => tx(router, routerAbi, "sealProtocolVaults", [], [], "A", "sealProtocolVaults"));
  addA("bindRouteExecutor", [curve, userRouter], () =>
    tx(curve, curveAbi, "bindRouteExecutor", [userRouter], ["executor"], "A", "bindRouteExecutor"),
  );

  const batchB: BuilderTx[] = [
    tx(vesting, vAbi, "activateLaunch", [], [], "B", "activateLaunch"),
    tx(guardian, gAbi, "pauseLaunches", [false], ["paused"], "B", "pauseLaunches(false) LAST"),
  ];

  return { roles, batchA, batchB, omitted, guardian, factory, usdc, vesting };
}

export function builderDoc(txs: BuilderTx[], name: string, description: string, chainId: string, safe: string) {
  const packed = packMultiSend(txs);
  return {
    version: "1.0",
    chainId,
    createdAt: Date.now(),
    meta: {
      name,
      description,
      txBuilderVersion: "1.16.5",
      createdFromSafeAddress: safe,
      createdFromOwnerAddress: "",
    },
    transactions: txs,
    multisend: {
      to: MULTISEND_CALL_ONLY,
      operation: 1,
      data: encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packed] }),
      packedTransactions: packed,
      note: "Verify MultiSendCallOnly on the target chain. Execute Batch A, then VerifyGenesis, then Batch B. Never A+B in one MultiSend.",
    },
  };
}

function writeAll() {
  const addrs = loadArtifactAddresses();
  const chainId = process.env.SAFE_CHAIN_ID ?? addrs.__chainId ?? "5042002";
  const built = buildBatches(addrs);
  const { roles, batchA, batchB, omitted } = built;
  const note =
    roles.localGuardian && roles.localGuardian !== roles.safe
      ? `Local artifact Guardian ${roles.localGuardian} is the Anvil demo authority (often deployer-controlled). This JSON rehearses a distinct Safe ${roles.safe}. Deployer ${roles.deployer} ≠ Safe.`
      : `Deployer ${roles.deployer} ≠ Safe ${roles.safe}.`;

  const batchADoc = builderDoc(
    batchA,
    "REACTOR Safe Genesis — Batch A",
    `Config while launchesPaused. Do not unpause. ${note}`,
    chainId,
    roles.safe,
  );
  const batchBDoc = builderDoc(
    batchB,
    "REACTOR Safe Genesis — Batch B",
    "T0 only after VerifyGenesis / verifyFullyWired while still paused. pauseLaunches(false) LAST.",
    chainId,
    roles.safe,
  );
  const index = {
    version: "1.0",
    chainId,
    createdAt: Date.now(),
    meta: {
      name: "REACTOR Safe Genesis",
      description: `${note} Batch A → VerifyGenesis → Batch B. Local test deployer ≠ Guardian Safe.`,
      txBuilderVersion: "1.16.5",
      createdFromSafeAddress: roles.safe,
    },
    source: "deployments/local.json + env overrides",
    deployer: roles.deployer,
    safe: roles.safe,
    localGuardian: roles.localGuardian ?? null,
    omittedBecauseMissingAddress: omitted,
    batchA: { file: "safe-genesis-batch-a.json", count: batchA.length },
    batchB: { file: "safe-genesis-batch-b.json", count: batchB.length },
    verify: "forge script script/VerifyGenesis.s.sol:VerifyGenesis --rpc-url $RPC",
    transactions: [...batchA, ...batchB],
    note: "Import Batch A JSON into Safe Transaction Builder, execute, verify on-chain, then import Batch B. Do not flatten A+B into one MultiSend.",
  };

  writeFileSync(join(root, "deployments/safe-genesis-batch-a.json"), JSON.stringify(batchADoc, null, 2));
  writeFileSync(join(root, "deployments/safe-genesis-batch-b.json"), JSON.stringify(batchBDoc, null, 2));
  writeFileSync(join(root, "deployments/safe-genesis-builder.json"), JSON.stringify(index, null, 2));
  console.log(
    JSON.stringify(
      { batchA: batchA.length, batchB: batchB.length, omitted, safe: roles.safe, deployer: roles.deployer },
      null,
      2,
    ),
  );
}

const invoked = process.argv[1]?.endsWith("safe-genesis-builder.ts");
if (invoked && !process.argv.includes("--test-only")) {
  writeAll();
}
