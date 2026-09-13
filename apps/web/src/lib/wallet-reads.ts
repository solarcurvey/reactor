import { throwIfAborted } from "./abort";
import type { BatchClient } from "./rpc-batch";
import { readContractsBatched } from "./rpc-batch";
import { erc20, token as tokenC } from "./contracts";

const erc20Abi = erc20.abi;

export type TicketWallet = {
  quoteBalance: bigint;
  tokenBalance: bigint;
  allowance: bigint;
  pendingRewards: bigint;
};

export type WalletSnapshot = {
  usdc: bigint;
  core: bigint;
  usdcAllowance: bigint;
};

/** One batched wave: quote + token balances, spender allowance, pending rewards. O(1) per ticket. */
export async function readTicketWallet(
  client: BatchClient,
  opts: {
    owner: `0x${string}`;
    quote: `0x${string}`;
    token: `0x${string}`;
    spender: `0x${string}`;
    payAsset: `0x${string}`;
    signal?: AbortSignal;
  },
): Promise<TicketWallet> {
  throwIfAborted(opts.signal);
  const [quoteBalance, tokenBalance, allowance, pendingRewards] = await readContractsBatched<bigint>(
    client,
    [
      { address: opts.quote, abi: erc20Abi, functionName: "balanceOf", args: [opts.owner] },
      { address: opts.token, abi: erc20Abi, functionName: "balanceOf", args: [opts.owner] },
      { address: opts.payAsset, abi: erc20Abi, functionName: "allowance", args: [opts.owner, opts.spender] },
      { address: opts.token, abi: tokenC.abi, functionName: "pendingRewards", args: [opts.owner] },
    ],
    { allowFailure: true },
  );
  return {
    quoteBalance: quoteBalance ?? 0n,
    tokenBalance: tokenBalance ?? 0n,
    allowance: allowance ?? 0n,
    pendingRewards: pendingRewards ?? 0n,
  };
}

/** One batched wave for the wallet page. Independent of catalog size. */
export async function readWalletSnapshot(
  client: BatchClient,
  opts: { owner: `0x${string}`; usdc: `0x${string}`; core: `0x${string}`; spender: `0x${string}`; signal?: AbortSignal },
): Promise<WalletSnapshot> {
  throwIfAborted(opts.signal);
  const [usdc, coreBal, usdcAllowance] = await readContractsBatched<bigint>(
    client,
    [
      { address: opts.usdc, abi: erc20Abi, functionName: "balanceOf", args: [opts.owner] },
      { address: opts.core, abi: erc20Abi, functionName: "balanceOf", args: [opts.owner] },
      { address: opts.usdc, abi: erc20Abi, functionName: "allowance", args: [opts.owner, opts.spender] },
    ],
    { allowFailure: true },
  );
  return { usdc: usdc ?? 0n, core: coreBal ?? 0n, usdcAllowance: usdcAllowance ?? 0n };
}

export async function readPendingRewardsPage(
  client: BatchClient,
  tokens: `0x${string}`[],
  owner: `0x${string}`,
  signal?: AbortSignal,
): Promise<bigint[]> {
  throwIfAborted(signal);
  if (tokens.length === 0) return [];
  return readContractsBatched<bigint>(
    client,
    tokens.map((token) => ({
      address: token,
      abi: tokenC.abi,
      functionName: "pendingRewards",
      args: [owner],
    })),
    { allowFailure: true },
  ).then((rows) => rows.map((v) => v ?? 0n));
}

export async function readCoreStatsBatched(
  client: BatchClient,
  core: { address: `0x${string}`; abi: unknown[] },
  buyback: { address: `0x${string}`; abi: unknown[] },
  usdc: `0x${string}`,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const [supply, accruedUsdc, lifetimeAccrued, lifetimeBurned, threshold, purchased] = await readContractsBatched<bigint>(
    client,
    [
      { ...core, functionName: "totalSupply" },
      { ...buyback, functionName: "accrued", args: [usdc] },
      { ...buyback, functionName: "lifetimeAccrued" },
      { ...buyback, functionName: "lifetimeBurned" },
      { ...buyback, functionName: "threshold" },
      { ...buyback, functionName: "lifetimePurchased" },
    ],
  );
  return { supply, burnedBal: lifetimeBurned, accruedUsdc, lifetimeAccrued, lifetimeBurned, threshold, purchased };
}

export const VESTING_READS = ["t0", "claimed", "vested", "claimable", "TOTAL"] as const;

export async function readVestingBatched(
  client: BatchClient,
  addr: `0x${string}`,
  abi: unknown[],
  signal?: AbortSignal,
): Promise<{ t0: bigint; claimed: bigint; vested: bigint; claimable: bigint; total: bigint }> {
  throwIfAborted(signal);
  const [t0, claimed, vested, claimable, total] = await readContractsBatched<bigint>(
    client,
    VESTING_READS.map((functionName) => ({ address: addr, abi, functionName })),
  );
  return { t0, claimed, vested, claimable, total };
}
