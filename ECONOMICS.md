# ECONOMICS

Official REACTOR pool only. External pools have no protocol charge.

| Item | Value |
| --- | --- |
| Native Uniswap LP fee | **0%** |
| REACTOR economic fee | **3.5% of actual quote notional** |
| Holders | **2.00%** same quote, never converted |
| Top-10 flywheel | **1.00%** async `FlywheelVault` |
| CORE buy + burn | **0.50%** isolated `coreBalance[quote]` |
| Creator / treasury / referral / creation | **0** |
| Transfer tax | **0** |

V1 swaps are exact-in. Incomplete fills revert. Fee is always quote-side.

## Worked $1,000 official trade

$20 holders (quote) · $10 flywheel · $5 CORE. Not an LP fee.

## Rewards

O(1) magnified dividend-per-share + per-account corrections. Leftover magnified remainder carries forward and is never allocated twice. No `outstanding <= backing + 1` slack. Claims indefinite. FairClaimVault owns auction inventory.

## Flywheel / CORE

- CORE is never Top-10 eligible (contract-level).
- Instant starting FDV is not a rank input. Instant USDC FDV $10k–$50k (default $25k).
- Top-10: $250k TWAP mcap floor. If no safe quote/USD path, tradable but not ranked.
- If `<10` eligible, full pot splits among them. If `0`, pot accumulates.
- Flywheel buys through the official pool may generate 3.5% fees; they do not recurse the same keeper call.
- KeeperReserve is isolated USDC bounties — no raid on holder quote.

## Instant / Fair

Instant: 1B / 18 dec, 100% locked single-sided liquidity, optional paid dev buy. Batch Fair Launch (not CCA) with `auctionBps` locked 5000.
