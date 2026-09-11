# CORE LIQUIDITY DESIGN

Frozen before `CoreLiquidityVault.initializeAndLock`. Not Instant bonding.

## Target

| Item | Value |
| --- | --- |
| Pair | CORE / USDC (6) |
| Hook | Official `ReactorHook` (`fee = 0`, `tickSpacing = 60`) |
| FDV at T0 | **$100,000** (`CORE_START_FDV_USDC = 100_000e6`) |
| Price | **$0.0001 / CORE** = 100 USDC-raw per 1e18 wei |
| Inventory | **900,000,000 CORE** + **~0 USDC** (single-sided) |
| Owner | `CoreLiquidityVault` only. `liquidityDelta < 0` reverts. |

`sqrtPriceX96 = LaunchMath.sqrtPriceFromFdv(core, usdc, 1e27, 100_000e6)`.

Human check: `1e18 * (100_000e6 / 1e27) = 100` USDC-raw = $0.0001.

## Single-sided range (frozen rule)

`LaunchMath.singleSidedRange(core, usdc, startTick, 60)`:

- If **CORE < USDC** (CORE is token0): current tick sits **below** the range. Position is 100% token0 (CORE). Buyers push tick up into the range and purchase CORE with USDC.
- If **USDC < CORE** (CORE is token1): current tick sits **above** the range. Position is 100% token1 (CORE). Buyers push tick down into the range.

Range width: from one spacing inside the start tick to the usable min/max tick. Wide on purpose so 900M CORE can sit as a single-sided ask without a second-sided USDC seed.

Liquidity: `LaunchMath.liquidityForSingleSided(core, usdc, lo, hi, vaultCOREBalance)`.

Rounding leftover CORE stays in `CoreLiquidityVault` forever (no sweep). `vault + PoolManager == 900M` at lock. Combined with 100M vesting this is the full 1B.

## Simulation (local Anvil / Foundry)

`CoreGenesisTest.test_28_09_lpPlusPmAccount900M` and `test_28_23_officialHookedCoreUsdc` lock the accounting. Ticks are **address-order dependent** (CREATE2 / deploy salt). Do not hardcode tick numbers in the vault — freeze the **formula** (`sqrtPriceFromFdv` + `singleSidedRange` + spacing 60). After a prod deploy, record the emitted `LiquidityLocked` ticks in `deployments/`.

Approximate tick from price (token1/token0):

`tick ≈ log_{1.0001}(price1per0)`.

Example if CORE is token0: `price = 100_000e6 / 1e27 = 1e-16` → tick ≈ **-368,400** (aligned to 60). Range `[aligned+60, maxUsable]`.

Example if CORE is token1: `price = 1e27 / 100_000e6 = 1e16` → tick ≈ **+368,400**. Range `[minUsable, aligned-60]`.

First USDC buys move price toward the range and fill from the 900M ask. Impact is large relative to a $100k FDV — that is intended for genesis, not a deep book.

## Quantitative buy impacts (Foundry v4, actual ticks)

Source: `CoreLiquiditySimTest.test_quantitativeBuyImpactsAtGenesis` + `test_fdvLadderBuyImpacts`.
Start FDV is frozen at **$100,000**. Do not casually raise it. If a rung is unreachable with the 900M single-sided ask, the table records the highest FDV the book actually reached.

Numbers from `CoreLiquiditySimTest` on this HEAD. Each spend is snapshot/reverted (sizes do not stack). FDV is 1B × official sqrtPrice (USDC-6). CORE is token1 in the local fixture (start tick +368432, range `[-887220, 368340]`, spacing 60).

| Book FDV (actual) | $100 → CORE | FDV after | $1k → CORE | FDV after | $10k → CORE | FDV after | $100k → CORE | FDV after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **$100,000** genesis | 955,145 | $101,139 | 9,461,083 | $103,080 | 86,433,306 | $123,508 | 463,615,155 | $429,282 |
| **$1,348,991** (walk; target $1M) | 71,514 | $1,349,775 | 713,277 | $1,356,843 | 6,951,490 | $1,428,531 | 55,428,060 | $2,246,913 |
| **$28,947,985** (walk; target $10M) | 3,333 | $28,951,617 | 33,315 | $28,984,315 | 331,278 | $29,312,308 | 3,136,793 | $32,693,729 |
| **$700,909,503** (walk; target $100M) | 138 | $700,927,374 | 1,377 | $701,088,223 | 13,750 | $702,697,736 | 135,945 | $718,894,354 |

Walk chunks overshoot the $10M / $100M labels — the book is continuous and a single large fill jumps FDV. **Genesis stays $100k.** The $100k-FDV / $100k-buy row (463.6M CORE, FDV → $429k) is the intended thin-ask pathology, not a reason to raise T0 FDV.

**APPROVED WORKING MAINNET CONFIG — SUBJECT TO AUDIT.** Current range accepted. No change to ~$100k T0 FDV, tick formula, or 900M single-sided ask. This pass re-ran the quantitative ladder and did not alter the frozen range. Mainnet remains blocked pending Codex + audits + KMS/Safe/rehearsal.

Implied average CORE price at genesis: $100 / 955,145 ≈ $0.000105 (vs $0.000100 mid) after 3.5% official fee + impact. At the ~$701M book a $100k buy moves FDV +2.6%.

## Forbidden

- Withdrawing the LP NFT / decreasing liquidity
- A second official CORE pool
- Hookless CORE/USDC as the protocol market
- Seeding deployer-owned CORE into a 50/50 hookless pool
