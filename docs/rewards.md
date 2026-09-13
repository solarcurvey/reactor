# Rewards

> Same-quote holder rewards. O(1). No staking. Persist across transfers. Not audited.

The 2% slice of the official / Instant **3.5%** is either holders (Rewards mode) or SelfBurn (Standard mode, or Rewards when nobody is eligible). The 1% Top-10 and 0.5% CORE always run. See [Economics](/docs/economics).

## What holders get

- Paid in the **quote the creator picked** (ZEC stays ZEC; it is never converted).
- **No staking.** Holding the ERC-20 is enough.
- Transfers have **zero tax**. Rewards persist; a new holder does not inherit the previous accumulator.
- Claims are indefinite. There is no expiry.

Accounting is magnified dividend-per-share plus per-account corrections. Leftover magnified remainder carries forward and is never allocated twice. Campaign asserts `outstanding <= backing` with **no** `+ 1` slack. Last claimer can still be short unassigned dust. This is residual risk, not a hidden extra fee.

## `eligibleSupply == 0`

If `eligibleRewardSupply()==0` (including the first curve buy, before tokens are delivered), the 2% goes to **SelfBurn** — not a rebate to the first holder. Any later Rewards fee event with zero eligible supply uses the same rule.

The first Instant buy always hits this path because fees are credited **before** tokens land.

Excluded from eligibility: PoolManager, liquidity vault, dead, and zero. The excluded set is immutable.

## Standard mode

The 2% accrues to `SelfBurnVault`. The designated Keeper later market-buys the launch token and burns it (`burn()`, no dead-address fallback). Same 20% chunk + cooldown + simulated `minOut` as other Keeper jobs. See [Keeper](/docs/keeper).

## Fair inventory

`FairClaimVault` owns unclaimed auction tokens and their quote slice. It is the O(1) eligible holder for that inventory. Fair bids themselves charge **0%**; rewards begin after migration.

## What rewards are not

- Not a creator fee
- Not a staking program
- Not an iteration over holders
- Not a Top-10 payment (that is the 1% flywheel)
- Not CORE (CORE never ranks; official CORE/USDC has no holder 2%)

Claim on the token page, or call the token’s claim path from a client. Indexer `RewardClaimed` rows are attribution, not custody.

Continue: [Traders](/docs/traders) · [Fees](/docs/fees) · [Top-10](/docs/top-10) · `ECONOMICS.md`.
