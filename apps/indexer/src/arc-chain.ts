/** Arc-compatible chain metadata. Native gas is USDC-18; protocol USDC ERC-20 is 6 decimals. */
export const ARC_NATIVE_GAS = { name: "USD Coin", symbol: "USDC", decimals: 18 } as const;

export const ARC_USDC_ERC20 = {
  address: "0x3600000000000000000000000000000000000000" as const,
  decimals: 6,
  note: "Canonical Arc USDC ERC-20. Not the 18-decimal gas unit.",
};

export function coreTokenAddress(addrs: Record<string, string>): `0x${string}` {
  const a = addrs.CoreToken ?? addrs.TestCORE;
  if (!a) throw new Error("CoreToken / TestCORE address missing");
  return a as `0x${string}`;
}
