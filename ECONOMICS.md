# ECONOMICS (immutable V1)

Protocol economics attach to the **Official REACTOR Pool**, not to the token.

## Official market

| Parameter | Value | Where |
| --- | --- | --- |
| Uniswap LP fee | **0%** (`fee = 0`) | `PoolKey.fee` |
| REACTOR protocol charge | **3% of quote notional** | Hook custom accounting |
| Holder share | **2%** of quote notional | `ReactorToken.creditRewards` |
| Buyback share | **1%** of quote notional | `BuybackVault.accrue` |
| Creator trading fee | None | — |
| Platform cash fee | None | — |
| Creation fee | None | — |
| Transfer / sell / wallet tax | None | Token transfers |
| Third-party pool tax | None | External pools uncharged |

Fee currency is **always the quote asset**, buy or sell.

## Quote notional

V1 router is **exact-in only** (`amountSpecified < 0`, `minOut > 0`). Incomplete fills revert.

Quote notional is the absolute quote-side amount of the concentrated-liquidity swap **before** the hook fee.

- Exact-in buy of the launch token: notional = specified quote in.
- Exact-in sell of the launch token: notional = absolute quote delta from the CL swap.

Split (floor, raw token units):

```
holders = notional * 200 / 10_000
buyback = notional * 100 / 10_000
fee     = holders + buyback
```

This keeps 2+1=3 with no remainder captured by the protocol. Dust notionals can yield `fee = 0`.

All-in frontend quotes:

- Buy: user pays `notional + fee` quote.
- Sell: user receives `notional - fee` quote.

## Token

- Default supply `1_000_000_000`, 18 decimals, configurable at launch.
- Mint once in the constructor. No owner mint, no blacklist, no honeypot, no transfer fee, no pause, no confiscation.
- Composable vanilla ERC-20 besides reward bookkeeping on transfer (zero economic fee).

## Holder rewards

Claimable in quote, no staking, O(1) accumulator. Rewards persist across transfers. Transfers do not dilute another account’s already-stored rewards.

### Eligibility

A balance is **eligible** unless the holder is one of:

| Address | Reason |
| --- | --- |
| `address(0)` | Non-account |
| `0x000000000000000000000000000000000000dEaD` | Burn sink |
| Uniswap `PoolManager` | Official + any v4 reserves |
| `ReactorLiquidityVault` | Locked inventory (should be 0; PM holds ERC-20) |
| `BuybackVault` | Should not hold launch tokens |
| The token contract itself | Accidental self-balance |

Eligible supply is `totalSupply - excludedBalance`, maintained on transfer. There is no admin function to exclude an arbitrary wallet (that would be honeypot-adjacent).

## Batch Fair Launch

Pro-rata timed sale — **not Uniswap CCA**. `auctionBps` is locked at 5000. **0% REACTOR charge** during the sale. Official pool opens at `sqrtPriceFromFdv(lpTokens, totalBids)` so the auction clearing price is the initial official price (TickMath rounding). Unclaimed auction tokens live in `FairClaimVault` and remain eligible; `settleClaim` is O(1).

## Buyback (testnet params)

1% accrues in `BuybackVault`. Permissionless `execute(quote)` — **caller cannot set minOut or size**.

| Param | Value |
| --- | --- |
| Max impact vs spot | 300 bps |
| Max chunk of accrued | 2000 bps |
| Min reserve of accrued | 1000 bps |
| Max spot vs reference | 1500 bps |
| Cooldown per quote | 5 minutes |
| Preferred route | quote → USDC → CORE unless quote is USDC |

V1 launches only against quotes with an approved buyback route. Failed or unsafe executes **no-op** and must never revert a user swap.

## Liquidity lock

Initial official LP is owned by `ReactorLiquidityVault`. No creator/deployer/admin withdraw. No upgrade path. Increase-only is allowed (compounding / extra lock). Collect is meaningless at 0% LP fee.

## V2

Any change to the 2/1 split, LP fee, or fee currency is a new deployment. V1 constants live in `ReactorConstants.sol` as `internal constant`.
