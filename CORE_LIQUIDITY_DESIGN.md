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

Numbers are filled from the Foundry run on this HEAD (see BUILD_REPORT). Columns are **CORE out** and **FDV after** the listed USDC buy, snapshot/reverted so sizes do not stack.

| Book FDV (approx) | $100 buy CORE out | $1k | $10k | $100k | Notes |
| --- | --- | --- | --- | --- | --- |
| $100k genesis | see test logs | see test logs | see test logs | see test logs | Pathological impact is intended at T0 |
| ~$1M | test | test | test | test | After walking the ask |
| ~$10M | test | test | test | test | May require large USDC |
| ~$100M | test | test | test | test | May be unreachable; document actual FDV |

`$100k` buy at `$100k` FDV is buying the entire advertised cap — expect extreme CORE out and a large FDV jump. That is not a reason to raise genesis FDV.

## Forbidden

- Withdrawing the LP NFT / decreasing liquidity
- A second official CORE pool
- Hookless CORE/USDC as the protocol market
- Seeding deployer-owned CORE into a 50/50 hookless pool
