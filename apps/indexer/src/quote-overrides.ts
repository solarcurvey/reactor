import { encodeAbiParameters, keccak256, pad, toHex, type Address, type Hex, type PublicClient } from "viem";

/** Common ERC-20 `balances` mapping slots. MockERC20 uses 3; OZ ERC-20 uses 0. */
export const BALANCE_MAPPING_CANDIDATES = [0n, 2n, 3n] as const;

const PREVIEW_CREDIT = (2n ** 96n) - 1n;

export function erc20BalanceSlot(holder: Address, mappingSlot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, mappingSlot]));
}

export function paddedUint(amount: bigint): Hex {
  return pad(toHex(amount), { size: 32 });
}

export type TokenStateDiff = { address: Address; stateDiff: Record<Hex, Hex> };

/**
 * Build eth_call stateDiff that credits `holder` on every candidate balance slot.
 * Writing unused mapping slots is harmless (they are not the token's name/symbol slots).
 */
export function creditBalanceDiffs(holder: Address, amount = PREVIEW_CREDIT): Record<Hex, Hex> {
  const value = paddedUint(amount);
  const diff: Record<Hex, Hex> = {};
  for (const slot of BALANCE_MAPPING_CANDIDATES) {
    diff[erc20BalanceSlot(holder, slot)] = value;
  }
  return diff;
}

export function quoterStateOverride(
  quoter: Address,
  tokens: readonly string[],
  amount = PREVIEW_CREDIT,
): Record<Address, { stateDiff: Record<Hex, Hex> }> {
  const override: Record<Address, { stateDiff: Record<Hex, Hex> }> = {};
  const seen = new Set<string>();
  for (const raw of tokens) {
    if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) continue;
    const token = raw.toLowerCase() as Address;
    if (seen.has(token)) continue;
    seen.add(token);
    override[token] = { stateDiff: creditBalanceDiffs(quoter, amount) };
  }
  return override;
}

export function uniquePathTokens(usdc?: string, token?: string, hops?: { tokenIn?: string; tokenOut?: string }[]): string[] {
  const out: string[] = [];
  for (const a of [usdc, token, ...(hops ?? []).flatMap((h) => [h.tokenIn, h.tokenOut])]) {
    if (a) out.push(a);
  }
  return out;
}

/** Probe which mapping slot `balanceOf(holder)` reads. Cached by the caller. */
export async function probeBalanceMappingSlot(
  client: Pick<PublicClient, "readContract">,
  token: Address,
  holder: Address,
): Promise<bigint | null> {
  const probe = 123_456_789n;
  const abi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
  for (const mappingSlot of BALANCE_MAPPING_CANDIDATES) {
    const slot = erc20BalanceSlot(holder, mappingSlot);
    try {
      const got = await client.readContract({
        address: token,
        abi,
        functionName: "balanceOf",
        args: [holder],
        stateOverride: { [token]: { stateDiff: { [slot]: paddedUint(probe) } } },
      });
      if (got === probe) return mappingSlot;
    } catch {
      /* try next */
    }
  }
  return null;
}

export const QUOTER_FALLBACK_NOTE =
  "UserRouteQuoter undeployed — executor simulateContract fallback may still need wallet balances. Deploy UserRouteQuoter for state-override nested quotes.";
