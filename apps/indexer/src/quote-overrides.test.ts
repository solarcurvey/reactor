import { creditBalanceDiffs, erc20BalanceSlot, quoterStateOverride, uniquePathTokens, QUOTER_FALLBACK_NOTE } from "./quote-overrides.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const quoter = "0x00000000000000000000000000000000000000aa" as const;
const usdc = "0x0000000000000000000000000000000000000001";
const zec = "0x0000000000000000000000000000000000000002";
const zcat = "0x0000000000000000000000000000000000000003";

{
  const tokens = uniquePathTokens(usdc, zcat, [{ tokenIn: usdc, tokenOut: zec }, { tokenIn: zec, tokenOut: zcat }]);
  assert(tokens.includes(usdc) && tokens.includes(zec) && tokens.includes(zcat), "path tokens");
  const override = quoterStateOverride(quoter, tokens);
  assert(override[usdc.toLowerCase() as `0x${string}`], "USDC override");
  assert(override[zec.toLowerCase() as `0x${string}`], "ZEC override — intermediate credited on quoter, not user");
  assert(override[zcat.toLowerCase() as `0x${string}`], "launch token override");
  const usdcDiff = override[usdc.toLowerCase() as `0x${string}`]!.stateDiff;
  const slot3 = erc20BalanceSlot(quoter, 3n);
  const slot0 = erc20BalanceSlot(quoter, 0n);
  assert(usdcDiff[slot3], "MockERC20 slot 3");
  assert(usdcDiff[slot0], "OZ slot 0");
  assert(Object.keys(creditBalanceDiffs(quoter)).length === 3, "three candidate slots");
}

{
  assert(QUOTER_FALLBACK_NOTE.includes("undeployed"), "fallback documented only for undeployed quoter");
  assert(QUOTER_FALLBACK_NOTE.includes("wallet balances"), "fallback may need wallet balances");
}

console.log("quote-overrides tests ok");
