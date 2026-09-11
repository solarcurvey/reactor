import { addresses } from "./addresses";
import factoryAbi from "./abi/ReactorFactory.json";
import routerAbi from "./abi/ReactorRouter.json";
import tokenAbi from "./abi/ReactorToken.json";
import registryAbi from "./abi/QuoteAssetRegistry.json";
import buybackAbi from "./abi/BuybackVault.json";
import hookAbi from "./abi/ReactorHook.json";
import erc20Abi from "./abi/MockERC20.json";
import coreAbi from "./abi/TestCORE.json";
import curveAbi from "./abi/InstantCurve.json";
import selfBurnAbi from "./abi/SelfBurnVault.json";
import { parseAbi } from "viem";

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
export const curve = { abi: curveAbi } as const;
export const selfBurn = { abi: selfBurnAbi } as const;

export const userRouteAbi = parseAbi([
  "function buy(address token, uint256 usdcIn, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minFinalOut, uint256 deadline) returns (uint256)",
  "function sell(address token, uint256 tokenIn, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minQuoteOut, uint256 minFinalOut, uint256 deadline) returns (uint256)",
]);

export const userRoute = {
  address: addresses.UserRouteExecutor as `0x${string}` | undefined,
  abi: userRouteAbi,
} as const;

export { factoryAbi, routerAbi, tokenAbi, registryAbi, buybackAbi, hookAbi, erc20Abi, coreAbi, curveAbi, selfBurnAbi };
