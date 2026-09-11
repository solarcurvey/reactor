import { encodeAbiParameters, keccak256 } from "viem";
import { addresses } from "./addresses";

export const LP_FEE = 0;
export const TICK_SPACING = 60;

export type PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export function officialPoolKey(token: `0x${string}`, quote: `0x${string}`): PoolKey {
  const [currency0, currency1] =
    token.toLowerCase() < quote.toLowerCase() ? [token, quote] : [quote, token];
  return {
    currency0,
    currency1,
    fee: LP_FEE,
    tickSpacing: TICK_SPACING,
    hooks: addresses.ReactorHook,
  };
}

export function poolId(key: PoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [key],
    ),
  );
}

export function buyZeroForOne(token: `0x${string}`, quote: `0x${string}`) {
  return quote.toLowerCase() < token.toLowerCase();
}
