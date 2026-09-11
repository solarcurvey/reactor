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

const launchAuthTuple =
  "(address factory,address creator,address quote,uint8 quoteDecimals,uint256 virtualQuote0,bytes32 curveConfig,bytes32 tickerHash,bytes32 authId,uint256 deadline)";

export const launchAbi = parseAbi([
  `function instantLaunch((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint256 fdvQuoteRaw,uint256 devBuyQuote,string image,string description,string website,string twitter,string telegram) p, ${launchAuthTuple} a, bytes sig) returns (address token, bytes32 poolId)`,
  `function launchStandard((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint256 fdvQuoteRaw,uint256 devBuyQuote,string image,string description,string website,string twitter,string telegram) p, ${launchAuthTuple} a, bytes sig) returns (address token, bytes32 poolId)`,
  `function launchAndBuy((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint256 fdvQuoteRaw,uint256 devBuyQuote,string image,string description,string website,string twitter,string telegram) p, bool rewards, uint256 minOut, ${launchAuthTuple} a, bytes sig) returns (address token, bytes32 poolId, uint256 tokensOut)`,
  `function createFairLaunch((string name,string symbol,uint8 decimals,uint256 supply,address quote,uint64 duration,uint16 auctionBps,uint256 minRaise,string image,string description,string website,string twitter,string telegram) p, ${launchAuthTuple} a, bytes sig) returns (address token, uint256 fairId)`,
]);

const factoryAbiArr = Array.isArray(factoryAbi)
  ? factoryAbi
  : ((factoryAbi as { abi?: unknown[] }).abi ?? []);

export const factory = {
  address: addresses.ReactorFactory,
  abi: [...factoryAbiArr, ...launchAbi] as typeof factoryAbi,
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
  address: (addresses.CoreToken ?? addresses.TestCORE) as `0x${string}`,
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
