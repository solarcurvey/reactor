# Nested fees

Official REACTOR LP fee is **0%**. The **3.5%** is hook custom accounting in **quote**:

| Slice | bps |
| --- | ---: |
| Holders (or SelfBurn if `eligibleSupply==0`) | 200 |
| Top-10 flywheel | 100 |
| CORE buy+burn | 50 |

A nested USDC → ZCAT → CAT path can charge 3.5% on **each** official REACTOR hop. `POST /quote` lists every official leg in `feeLegs[]`. `reactorFeeCount` and `totalProtocolFeeBps` are the sums.

Fair auction: **0%** during the sale. 3.5% starts after one migration.

Maintenance / Top-10 / CORE / SelfBurn use the **fee-exempt** planner. Never `minOut` 0 or 1.

CI (`pnpm docs:check`) fails if this page drifts from `ReactorConstants`.
