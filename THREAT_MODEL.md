# THREAT MODEL

Hostile-reader notes for Codex / external review. **Not an audit.**

## Assets

- Official pool reserves (in `PoolManager`)
- Locked v4 positions (owned by `ReactorLiquidityVault`)
- Holder reward quote (in each `ReactorToken`)
- Buyback quote reserve and TestCORE
- Quote allowlist integrity
- Hook permission bits / CREATE2 identity

## Actors

| Actor | Intent |
| --- | --- |
| Honest trader / launcher / bidder | Use the product |
| MEV searcher | Sandwich, JIT, backrun buyback |
| Malicious creator | Reclaim LP, hidden mint, tax, exclude holders |
| Malicious hook caller | Charge unofficial pools, steal deltas |
| Malicious quote | Fee-on-transfer, rebase, 6-vs-18 confusion |
| Compromised registry admin | List a hostile quote |
| PoolManager (Uniswap) | Trusted v4 singleton; BUSL; not our code |

## Controls

1. **No owner mint / pause / blacklist / tax** on `ReactorToken`.
2. **No LP withdraw** on the vault.
3. **Hook only charges `officialPool`.** Initialize gated to factory + 0% fee + registered quote.
4. **Fee always quote** via specified/unspecified split (ADR-006).
5. **Rewards O(1)**; debt synced on every transfer; excluded set immutable.
6. **Buyback CORE target immutable**; single registered hookless route; reentrancy guard; `minCoreOut`.
7. **Fair finalize once**; auction has no hook.
8. **Registry admin cannot** withdraw, mint, or change fee BPS.
9. **FoT / rebase quotes:** `creditRewards` / vault `accrue` measure actual received; shortfall reverts. Rebasing quotes are unsupported (document + do not register).

## Residual risks (highest first)

1. **Hook custom accounting** — wrong sign on `BeforeSwapDelta` / afterSwap unspecified delta can steal from swappers or insolvent the hook. Tests cover exact-in/out × buy/sell × token0/token1.
2. **Reward solvency** — rounding, leftover, excluded-supply = 0, notify during swap. Invariant: token quote balance ≥ sum(stored + pending eligible).
3. **CREATE2 hook bits** — a mis-mined address silently skips callbacks (0% charged) or enables extra callbacks.
4. **Single-sided launch price** — extreme FDV vs 1e9 supply can clamp to TickMath edges and look “wrong” versus the UI valuation.
5. **Buyback sandwich** — permissionless execute; caller sets `minCoreOut`. No TWAP. Pending is acceptable.
6. **Registry admin lists FoT/rebase quote** — operational, not a custody risk.
7. **v4-core BUSL / unaudited REACTOR** — legal + quality. No audit claim.
8. **Arc dual-decimal USDC** — mixing `address.balance` (18) with `USDC.balanceOf` (6) by 1e12. Contracts use the ERC-20 interface only.
9. **Arc value-transfer rules** — native send to `address(0)` reverts; blocklisted index-1 test address reverts. Vaults never burn native USDC to zero.
10. **Flash / sandwich / JIT** on official pools — accepted AMM risk; 0% LP fee reduces JIT incentive.

## Explicit non-goals

We do not prevent external pools, creator dumping after a paid buy, or social-engineering of the registry admin.
