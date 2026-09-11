import { addresses } from "./addresses";
import factoryAbi from "./abi/ReactorFactory.json";
import routerAbi from "./abi/ReactorRouter.json";
import tokenAbi from "./abi/ReactorToken.json";
import registryAbi from "./abi/QuoteAssetRegistry.json";
import buybackAbi from "./abi/BuybackVault.json";
import hookAbi from "./abi/ReactorHook.json";
import erc20Abi from "./abi/MockERC20.json";
import coreAbi from "./abi/TestCORE.json";

export const factory = {
  address: addresses.ReactorFactory,
  abi: factoryAbi,
} as const;

export const router = {
  address: addresses.ReactorRouter,
  abi: routerAbi,
} as const;

export const registry = {
  address: addresses.QuoteAssetRegistry,
  abi: registryAbi,
} as const;

export const buyback = {
  address: addresses.BuybackVault,
  abi: buybackAbi,
} as const;

export const hook = {
  address: addresses.ReactorHook,
  abi: hookAbi,
} as const;

export const core = {
  address: addresses.TestCORE,
  abi: coreAbi,
} as const;

export const erc20 = { abi: erc20Abi } as const;
export const token = { abi: tokenAbi } as const;

export { factoryAbi, routerAbi, tokenAbi, registryAbi, buybackAbi, hookAbi, erc20Abi, coreAbi };
