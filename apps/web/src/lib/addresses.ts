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
  };
  hookFlags: string;
  v4Core: string;
};

export const deployment = local as Deployment;
export const addresses = deployment.addresses;

export const CATEGORY_LABELS = [
  "Crypto",
  "Stocks",
  "Commodities",
  "FX",
  "Stablecoins",
  "Arc ecosystem",
] as const;
