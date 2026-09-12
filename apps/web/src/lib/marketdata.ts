import { hexToBigInt, keccak256, concat, pad, toHex, type PublicClient } from "viem";
import { addresses } from "./addresses";

/**
 * Pool-state helpers used by the local route graph preview.
 *
 * Official Top-10 ranking no longer lives here. Direct Factory walks and the
 * assumed hookless 0.30% quote/USDC fallback were removed (issue #10).
 * Keeper + `/api/reactor/top10` read `GET {indexer}/top10`.
 *
 * VWAP / rank helpers: `packages/reactor/src/top10.ts`.
 */

/** Mirror of `@reactor/core` consumeIndexerValuation — keep web free of that package graph. */
export function consumeIndexerValuation(
  response: { ok?: boolean; usd6?: string } | null,
  reachable: boolean,
): { usd6: bigint; ok: boolean } | "offline" {
  if (!reachable || response == null) return "offline";
  if (response.ok && response.usd6) {
    try {
      const usd6 = BigInt(response.usd6);
      if (usd6 > 0n) return { usd6, ok: true };
    } catch {
      return { usd6: 0n, ok: false };
    }
  }
  return { usd6: 0n, ok: false };
}

const POOLS_SLOT = 6n;

const extsloadAbi = [
  { name: "extsload", type: "function", stateMutability: "view", inputs: [{ name: "slot", type: "bytes32" }], outputs: [{ name: "value", type: "bytes32" }] },
] as const;

function poolStateSlot(id: `0x${string}`): `0x${string}` {
  return keccak256(concat([id, pad(toHex(POOLS_SLOT), { size: 32 })]));
}

export async function readSqrtPriceX96(client: PublicClient, id: `0x${string}`): Promise<bigint | null> {
  try {
    const word = (await client.readContract({
      address: addresses.PoolManager,
      abi: extsloadAbi,
      functionName: "extsload",
      args: [poolStateSlot(id)],
    })) as `0x${string}`;
    const sqrt = hexToBigInt(word) & ((1n << 160n) - 1n);
    return sqrt === 0n ? null : sqrt;
  } catch {
    return null;
  }
}
