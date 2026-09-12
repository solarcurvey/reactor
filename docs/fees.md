# Nested fees

Official REACTOR LP fee is **0%**. The **3.5%** is hook custom accounting in **quote**:

| Slice | bps |
| --- | ---: |
| Holders (or SelfBurn if `eligibleSupply==0`) | 200 |
| Top-10 flywheel | 100 |
| CORE buy+burn | 50 |

A nested USDC → ZEC → ZCAT → CAT user path can charge 3.5% on **each** official REACTOR hop. `POST /quote` lists every official user-charged leg in `feeLegs[]` for the **scored winner** plus that winner’s terminal market — never an independently tracked max-`amountOut` preview. Hookless hops are **not** REACTOR fees. Protocol / Keeper routes list official edges in `exemptOfficialLegs[]` with `protocolFeeBps = 0`.

### Worked nested example (user BUY)

Path: **USDC → ZEC → ZCAT → CAT**

| Hop | Kind | REACTOR fee |
| --- | --- | --- |
| USDC → ZEC | `EXTERNAL_V4_HOOKLESS` | none |
| ZEC → ZCAT | `OFFICIAL_REACTOR_V4` | **3.5%** of ZEC notional |
| ZCAT → CAT | `OFFICIAL_REACTOR_V4` | **3.5%** of ZCAT notional |

`feeLegs[]` has **two** official entries. `reactorFeeCount = 2`. `totalProtocolFeeBps = 700` (350 + 350). Sequential takes compound: `1 − (1 − 0.035)² = 0.068775` → `aggregateProtocolImpactBps = 688` (**6.88%** before slippage). The UI must render these ticket fields — it must not reconstruct 3.5% from a single notional.

The two official legs are **different quote assets** (ZEC-8 and ZCAT-18). The trade ticket formats **each** charged leg with that hop’s quote token and decimals. It must not add `holders` / `flywheel` / `core` raw amounts across legs and then scale the sum with the terminal market’s `quoteDecimals`. The only denomination-independent aggregate is `aggregateProtocolImpactBps` (688).

The matching **SELL** (CAT → ZCAT → ZEC → USDC) also reports two official 3.5% legs (CAT→ZCAT and ZCAT→ZEC). ZEC→USDC stays hookless.

Fair auction: **0%** during the sale. 3.5% starts after one migration.

Maintenance / Top-10 / CORE / SelfBurn use the **fee-exempt** planner. Official edges appear in `exemptOfficialLegs[]`, never as user `feeLegs[]`. Never `minOut` 0 or 1.

CI (`pnpm docs:check`) fails if this page drifts from `ReactorConstants`.
