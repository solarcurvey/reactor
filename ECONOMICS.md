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
- Instant starting FDV is not a rank input. Protocol Instant start is ~$5k USDC FDV on a bonding curve (see `CURVE_DESIGN.md`). Ungraduated Instant tokens are not Top-10 eligible.
- Top-10: $250k TWAP mcap floor. If no safe quote/USD path, tradable but not ranked.
- If `<10` eligible, full pot splits among them. If `0`, pot accumulates.
- Each ranked name is paid `epochPot * weight / weightSum` (pot snapshotted at `finalizeEpoch`). A later exec cannot shrink an earlier share.
- `#11` is never ranked and receives zero.
- Flywheel buys through the official pool may generate 3.5% fees; they do not recurse the same keeper call (`bought[epoch][token]` is set before the swap).
- KeeperReserve is isolated USDC bounties — no raid on holder quote. Same `op` pays once.
- Market TWAP needs **n ≥ 2** samples in the last epoch. A single spot print after a pump does not qualify. Instant FDV is never substituted for TWAP mcap.

## Instant / Fair

Instant is **bonding curve → v4 graduation**, not single-sided permanent v4 from trade #1.

| Item | Value |
| --- | --- |
| Supply / decimals | Protocol: 1B / 18. Creator cannot set. |
| Curve inventory | 79.31% |
| v4 reserve | 20.69% locked forever at graduation |
| Start FDV (USDC) | ~$5,000 (`CURVE_DESIGN.md`) |
| Graduation | Permissionless when economic quote hits the target. Protocol fee quote is **not** LP. |
| Modes (3.5% both) | **Rewards**: 2% holders. **Standard**: 2% SelfBurn (later market-buy + burn). Both: 1% Top-10 + 0.5% CORE. |
| Dev buy | Optional, atomic `launchAndBuy`, full 3.5%, max 5% supply by token out. Reverts if over. No free allocation. |
| Maintenance | Self-burn / Top-10 / CORE buys are fee-exempt only via authenticated vault executors (`protocolSwap` / `buyExempt`). |

Batch Fair Launch (not CCA) with `auctionBps` locked 5000.
