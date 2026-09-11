import { getAddress } from "viem";
import local from "./deployment.json";

export type Deployment = {
  network: string;
  chainId: number;
  rpc: string;
  claimedArcTestnet: boolean;
  note: string;
  addresses: {
    PoolManager: `0x${string}`;
    QuoteAssetRegistry: `0x${string}`;
    TestCORE: `0x${string}`;
    USDC: `0x${string}`;
    ZEC: `0x${string}`;
    BTC: `0x${string}`;
    NVDA: `0x${string}`;
    ReactorLiquidityVault: `0x${string}`;
    ReactorRouter: `0x${string}`;
    ReactorHook: `0x${string}`;
    BuybackVault: `0x${string}`;
    FlywheelVault?: `0x${string}`;
    ReactorFactory: `0x${string}`;
    FairClaimVault?: `0x${string}`;
    InstantCurve?: `0x${string}`;
    SelfBurnVault?: `0x${string}`;
    Guardian?: `0x${string}`;
    UserRouteExecutor?: `0x${string}`;
    V4Adapter?: `0x${string}`;
    ProtocolV4Adapter?: `0x${string}`;
    RoutingRegistry?: `0x${string}`;
    CoreVesting?: `0x${string}`;
    CoreLiquidityVault?: `0x${string}`;
    CoreBuybackExecutor?: `0x${string}`;
  };
  hookFlags: string;
  v4Core: string;
};

export const deployment = local as Deployment;

function checksumAddresses<T extends Record<string, string | undefined>>(raw: T): T {
  const out = { ...raw };
  for (const key of Object.keys(out) as (keyof T)[]) {
    const value = out[key];
    if (typeof value === "string" && value.startsWith("0x") && value.length === 42) {
      out[key] = getAddress(value) as T[keyof T];
    }
  }
  return out;
}

export const addresses = checksumAddresses(deployment.addresses);

export const CATEGORY_LABELS = [
  "Crypto",
  "Stocks",
  "Commodities",
  "FX",
  "Stablecoins",
  "Arc ecosystem",
  "REACTOR native",
] as const;
