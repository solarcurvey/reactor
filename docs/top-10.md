# Top-10 — TRUST ASSUMPTION

1% of official quote notional accrues to the flywheel. The designated Keeper settles quote→USDC, submits an epoch, and buys+burns the published set.

## What contracts check

Structure only: ≤10 addresses, no CORE, no duplicates, weights sum to 100%. No mcap oracle. No TWAP. No Pyth.

## What the API does

Offchain ranker uses official prices, nested USD via **one** `ValuationService`, a $250k floor, and fail-closed marks. A dead low-value graduate does not freeze the set. A **material** unvalued candidate does.

**This is not a trustless oracle.** A compromised API + Keeper can point the pot at the wrong set. Guardian cannot set members. See `KEEPER_MODEL.md`.
