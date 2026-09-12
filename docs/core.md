# CORE

> **Not Instant. Not a creator launch. Never Top-10.** Token name **REACTOR CORE**, symbol **CORE**. `TestCORE` is a deprecated alias. Not audited.

CORE is protocol genesis: a permanent official CORE/USDC Uniswap v4 pool with the normal REACTOR hook from block one. There is no bonding curve, no graduation, no Rewards mode, and no creator knobs.

Do not deploy to Arc Mainnet. Source: `CORE_GENESIS.md`, `CORE_LIQUIDITY_DESIGN.md`.

## Supply

Exactly **1,000,000,000e18**, minted once in `CoreToken.genesis`. Nobody can mint after — not Guardian, not Keeper, not the deployer.

`burn(uint256)` reduces `totalSupply`. There is **no** `0xdead` fallback.

| Destination | Amount | Contract |
| --- | --- | --- |
| Vesting | 100,000,000 | `CoreVesting` (immutable beneficiary) |
| Official LP | 900,000,000 | `CoreLiquidityVault` → PoolManager |
| Deployer / Guardian / Keeper / treasury | **0** | — |

After genesis those three buckets account for the whole supply (LP residual dust stays in the vault and cannot be withdrawn).

`registerNative` on the quote registry is **not** silent — Factory forwards failures so a graduated token is actually registered. That is a Factory behavior note, not a CORE mint.

## Vesting

- Beneficiary **immutable**: `0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406`
- **T0 = public REACTOR launch**, not necessarily deploy time.
  - Prod: pass nonzero `t0` to the constructor → frozen immediately.
  - Testnet / local: `t0 = 0` then Guardian `activateLaunch()` **once** (sets `t0 = block.timestamp`) → frozen.
- 30-day cliff: **zero** unlocked at day 30 (and before).
- Then **10 × 30 days** continuous linear to 100%. No lump at the cliff.
- `claim()` sends only to the beneficiary.
- No owner, admin, Guardian/Keeper withdraw, revoke, change, accelerate, sweep, or upgrade.

## Official CORE/USDC book

| Item | Value |
| --- | --- |
| Pair | CORE / USDC (6) |
| Hook | Official `ReactorHook` (`fee = 0`, `tickSpacing = 60`) |
| FDV at T0 | **$100,000** (`CORE_START_FDV_USDC = 100_000e6`) |
| Price | **$0.0001 / CORE** |
| Inventory | **900,000,000 CORE** + **~0 USDC** (single-sided) |
| Owner | `CoreLiquidityVault` only. `liquidityDelta < 0` reverts. |

Still **3.5%** of quote notional. Because a Standard 2% and the protocol 0.5% would both target CORE, they consolidate:

| Bucket | CORE/USDC | Other official markets |
| --- | --- | --- |
| Holders / SelfBurn | **0%** | 2.0% |
| Top-10 flywheel | **1.0%** | 1.0% |
| CORE buy+burn (USDC reserve) | **2.5%** | 0.5% |

No double-charge. Maintenance buys are fee-exempt only through `CoreBuybackExecutor` (a sealed protocol vault). The Keeper EOA is not exempt. `minTargetOut` required; 20% chunk + cooldown.

## Single-sided range

`LaunchMath.singleSidedRange` places the 900M as a single-sided ask. Ticks are **address-order dependent** (CREATE2 / deploy salt). Do not hardcode tick numbers in the vault — freeze the **formula** (`sqrtPriceFromFdv` + `singleSidedRange` + spacing 60).

Range width: from one spacing inside the start tick to the usable min/max tick. Rounding leftover CORE stays in `CoreLiquidityVault` forever (no sweep). `vault + PoolManager == 900M` at lock.

First USDC buys move price toward the range and fill from the 900M ask. Impact is large relative to a $100k FDV — that is intended for genesis, not a deep book. **Genesis stays $100k.** Do not casually raise T0 FDV.

Quantitative ladder (Foundry, local fixture; CORE is token1): see `CORE_LIQUIDITY_DESIGN.md` / `CoreLiquiditySimTest`. The $100k-FDV / $100k-buy row (~463.6M CORE, FDV → ~$429k) is the intended thin-ask pathology, not a reason to raise T0 FDV.

## Top-10

CORE is rejected on `submitEpoch` and `executeTop10Buyback` even if the Keeper includes it. Ungraduated Instant names are also rejected. Not a trustless oracle.

Live UI: a bottom-right toast appears when the indexer has committed `BuybackExecuted` / `COREBurned` (SSE `core`, `confirmed`, `id >` first-session `hello.head`). Dedupe is `(chainId, tx, logIndex, eventKind)`. This is not an onchain oracle and not a Top-10 event — CORE never ranks.

## Forbidden

- Withdrawing the LP NFT / decreasing liquidity
- A second official CORE pool
- Hookless CORE/USDC as the protocol market
- Seeding deployer-owned CORE into a 50/50 hookless pool
- Mint-all-to-deployer
- Treating CORE as Instant or as a Top-10 member

## Tests

`test/unit/CoreGenesis.t.sol` and `test/invariant/CoreInvariant.t.sol`. Liquidity accounting: `CoreLiquiditySim.t.sol`.

Continue: [Economics](/docs/economics) · [Security](/docs/security) · `CORE_GENESIS.md`.
