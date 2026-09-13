# Nested fees

Official REACTOR LP fee is **0%**. The **3.5%** is hook custom accounting in **quote**:

| Slice | bps |
| --- | ---: |
| Holders (or SelfBurn if `eligibleSupply==0`) | 200 |
| Top-10 flywheel | 100 |
| CORE buy+burn | 50 |

A nested USDC → ZEC → ZCAT → CAT user path can charge 3.5% on **each** official REACTOR hop. `POST /quote` lists every official user-charged leg in `feeLegs[]` for the **scored winner** plus that winner’s terminal market — never an independently tracked max-`amountOut` preview. Hookless hops are **not** REACTOR fees. Protocol / Keeper routes list official edges in `exemptOfficialLegs[]` with `protocolFeeBps = 0`.

CI (`pnpm docs:check`) fails if this page drifts from `ReactorConstants`.

## How the hook takes the fee

```
User → ReactorRouter.unlock
     → PoolManager.swap (lpFee = 0)
         → hook.beforeSwap   (quote specified  → take 3.5% unless protocolExempt)
         → CL swap
         → hook.afterSwap    (quote unspecified → take 3.5% unless protocolExempt)
             → split 2 / 1 / 0.5
             → Rewards: token.creditRewards · Standard: SelfBurn.accrue
             → flywheel.accrue + buyback.accrue
     → settle / take
```

Pre-graduation Instant trades settle on `InstantCurve` (same 3.5% quote split). After `graduate()`, the official hooked 0% LP pool is the market. Flush derives quote from `marketOfToken`; a mismatched two-arg flush reverts.

Fee-on-transfer quotes: `creditRewards` / vault `accrue` measure **actual received**; shortfall reverts. Rebasing quotes are unsupported — do not register them.

## Worked nested example (user BUY)

Path: **USDC → ZEC → ZCAT → CAT**

| Hop | Kind | REACTOR fee |
| --- | --- | --- |
| USDC → ZEC | `EXTERNAL_V4_HOOKLESS` | none |
| ZEC → ZCAT | `OFFICIAL_REACTOR_V4` | **3.5%** of ZEC notional |
| ZCAT → CAT | `OFFICIAL_REACTOR_V4` | **3.5%** of ZCAT notional |

`feeLegs[]` has **two** official entries. `reactorFeeCount = 2`. `totalProtocolFeeBps = 700` (350 + 350). Sequential takes compound: `1 − (1 − 0.035)² = 0.068775` → `aggregateProtocolImpactBps = 688` (**6.88%** before slippage). The UI must render these ticket fields — it must not reconstruct 3.5% from a single notional.

The two official legs are **different quote assets** (ZEC-8 and ZCAT-18). The trade ticket formats **each** charged leg with that hop’s quote token and decimals. It must not add `holders` / `flywheel` / `core` raw amounts across legs and then scale the sum with the terminal market’s `quoteDecimals`. The only denomination-independent aggregate is `aggregateProtocolImpactBps` (688).

The matching **SELL** (CAT → ZCAT → ZEC → USDC) also reports two official 3.5% legs (CAT→ZCAT and ZCAT→ZEC). ZEC→USDC stays hookless.

## Instant terminal / partial fills

Fees apply only to **executed gross quote**. Unexecuted input plus the **unearned** fee is refunded. Ready-lock then forbids further curve trades until `graduate`. See [Lifecycle](/docs/lifecycle).

## Fair auction

**0%** during the sale. 3.5% starts after one migration onto the official pool.

## Official CORE/USDC

Still 3.5% of quote notional, but the 2% holder slice would double-target CORE. The book consolidates to **2.5% buy+burn + 1% flywheel**. See [CORE](/docs/core).

## Maintenance / exempt path

Maintenance / Top-10 / CORE / SelfBurn use the **fee-exempt** planner. Official edges appear in `exemptOfficialLegs[]`, never as user `feeLegs[]`. Exemption is only via sealed vault executors calling `protocolSwap` / `buyExempt`. The Keeper EOA is never allowlisted. Never `minOut` 0 or 1.

`protocolExempt` is router-scoped and `nonReentrant`. User `swap` reverts `WalletExemptForbidden` while the latch is set.

Continue: [Economics](/docs/economics) · [Quoting](/docs/quoting) · [Rewards](/docs/rewards).
