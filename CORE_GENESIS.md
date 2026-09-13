# CORE GENESIS

**Not Instant. Not a creator launch. Not Top-10 eligible.**

CORE is protocol genesis: a permanent official CORE/USDC Uniswap v4 pool with the normal REACTOR hook from block one. There is no bonding curve, no graduation, no Rewards mode, and no creator knobs.

This is **not audited**. Do not deploy to Arc Mainnet.

## Supply

Exactly **1,000,000,000e18**, minted once in `CoreToken.genesis` (`TestCORE` is a deprecated alias). Nobody can mint after — not Guardian, not Keeper, not the deployer.

`burn(uint256)` reduces `totalSupply`. There is **no** `0xdead` fallback.

## Atomic distribution (full 1B)

| Destination | Amount | Contract |
| --- | --- | --- |
| Vesting | 100,000,000 | `CoreVesting` (immutable beneficiary) |
| Official LP | 900,000,000 | `CoreLiquidityVault` → PoolManager |
| Deployer / Guardian / Keeper / treasury | **0** | — |

After genesis those three buckets account for the whole supply (LP residual dust stays in the vault and cannot be withdrawn).

## Vesting

- Beneficiary **immutable**: `0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406`
- **T0 = public REACTOR launch**, not necessarily deploy time.
  - Prod: pass nonzero `t0` to the constructor → frozen immediately.
  - Testnet / local: `t0 = 0` then Guardian `activateLaunch()` **once** (sets `t0 = block.timestamp`) → frozen.
- 30-day cliff: **zero** unlocked at day 30 (and before).
- Then **10 × 30 days** continuous linear to 100%. No lump at the cliff.
- `claim()` sends only to the beneficiary.
- No owner, admin, Guardian/Keeper withdraw, revoke, change, accelerate, sweep, or upgrade.

## Market

Official CORE/USDC: `fee = 0`, `tickSpacing = 60`, `ReactorHook`. Start FDV **~$100k** (~$0.0001 / CORE). Single-sided concentrated 900M CORE + ~0 USDC. Permanent lock — see `CORE_LIQUIDITY_DESIGN.md`.

## Economics on CORE/USDC

Still **3.5%** of quote notional. Because a Standard 2% and the protocol 0.5% would both target CORE, they consolidate:

| Bucket | CORE/USDC | Other official markets |
| --- | --- | --- |
| Holders / SelfBurn | **0%** | 2.0% |
| Top-10 flywheel | **1.0%** | 1.0% |
| CORE buy+burn (USDC reserve) | **2.5%** | 0.5% |

No double-charge. Maintenance buys are fee-exempt only through `CoreBuybackExecutor` (a sealed protocol vault). Relayer EOAs and the job signer are not exempt. `minTargetOut` required; 20% chunk + cooldown.

## Top-10

CORE is rejected on `submitEpoch` and `executeTop10Buyback` even if the Keeper includes it. Ungraduated Instant names are also rejected. Not a trustless oracle.

## Deploy order

1. Guardian + Keeper (`pauseLaunches = true`)
2. CORE (unminted)
3. Hook / registry USDC
4. `CoreVesting` + `CoreLiquidityVault`
5. `genesis(100M, 900M)` → `initializeAndLock`
6. CoreBuyback executor wired
7. Rest of REACTOR (factory, curve, flywheel, …)
8. Verify Top-10 exclude + balances (deployer CORE = 0, 100/900)
9. Tiny test buyback (supply decreases)
10. **Then** `pauseLaunches(false)` and `activateLaunch()` (T0)

CORE exists before the first public 0.5% accrual.

Testnet uses this same 10/90 structure. Do not mint-all-to-deployer.

## Tests

`test/unit/CoreGenesis.t.sol` (§28, 35 cases) and `test/invariant/CoreInvariant.t.sol` (§29).
