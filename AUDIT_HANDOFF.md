# AUDIT HANDOFF — REACTOR V1

**This software has not been audited.** Treat every contract as hostile-unreviewed. Do not deploy to Arc Mainnet.

**This pass:** `forge test` **82 passed / 0 failed / 1 skipped**. Slither 0.11.6 on this tree: **142 findings** (16 High / 64 Medium / 54 Low / 8 Info) — see `HARDENING_REPORT.md`. **Arc Public Testnet was not deployed** (no funded deployer key and no faucet in this environment).

## Overview

REACTOR launches ERC-20s into Official REACTOR Pools: Uniswap v4 pools with `fee = 0`, `tickSpacing = 60`, and `ReactorHook`. The hook charges **3.5% of quote notional** via custom accounting (not an LP fee): 2% holders, 1% Top-10 flywheel, 0.5% CORE buy+burn.

## Contract map

| Contract | Path | Notes |
| --- | --- | --- |
| `ReactorFactory` | `contracts/src/ReactorFactory.sol` | Instant + Batch Fair Launch, metadata |
| `FairClaimVault` | `contracts/src/FairClaimVault.sol` | Eligible holder of unclaimed auction tokens |
| `ReactorHook` | `contracts/src/ReactorHook.sol` | Official identity + fee |
| `ReactorToken` | `contracts/src/ReactorToken.sol` | ERC-20 + O(1) rewards |
| `ReactorRouter` | `contracts/src/ReactorRouter.sol` | Unlock swaps / liquidity |
| `ReactorLiquidityVault` | `contracts/src/ReactorLiquidityVault.sol` | Lock-only LP owner |
| `BuybackVault` | `contracts/src/BuybackVault.sol` | Isolated 0.5% CORE pot; `execute` / `executeCoreBuyback` |
| `FlywheelVault` | `contracts/src/FlywheelVault.sol` | Isolated 1% Top-10 pot; finalize / buy+burn |
| `MarketOracle` | `contracts/src/MarketOracle.sol` | Permissionless samples; n≥2 TWAP; CORE ineligible |
| `KeeperReserve` | `contracts/src/KeeperReserve.sol` | Isolated USDC bounties; `paid[op]` once |
| `RoutingRegistry` | `contracts/src/RoutingRegistry.sol` | Owner routes; USDC hops must be hookless |
| `QuoteAssetRegistry` | `contracts/src/QuoteAssetRegistry.sol` | Curated quotes |
| `TestCORE` | `contracts/src/TestCORE.sol` | Platform token, mint once |
| `MockERC20` | `contracts/src/MockERC20.sol` | Test quotes (open mint) |
| `PoolManager` | Uniswap v4-core | BUSL-1.1, non-production |

Addresses: `deployments/local.json` (local demo). Hook CREATE2 **moves when hook bytecode changes** — read `factory.hook()`. Current local hook `0x27Cf52D1606345AaE2837c4a667fD57C68B9B0cc` (flags `0x30CC`).

## Dependency commits

| Repo | Commit |
| --- | --- |
| Uniswap/v4-core | `e50237c43811bd9b526eff40f26772152a42daba` |
| Uniswap/v4-periphery (LiquidityAmounts, HookMiner pattern) | `dce236d4e2057422d0791d9a973a58765eb46f65` |
| foundry-rs/forge-std | `bf647bd6046f2f7da30d0c2bf435e5c76a780c1b` |
| Foundry toolchain | 1.8.1 (`982849d314`) |

Install: `cd contracts && forge install`.

## Hook permissions

Address bits (CREATE2 mined):

```
BEFORE_INITIALIZE | AFTER_INITIALIZE | BEFORE_SWAP | AFTER_SWAP
| BEFORE_SWAP_RETURNS_DELTA | AFTER_SWAP_RETURNS_DELTA
= 0x30CC
```

`Hooks.validateHookPermissions` runs in the constructor. Test `test_hookBits` asserts `uint160(hook) & 0x3FFF == flags`.

## Fee / reward math

See `ECONOMICS.md` and `FeeMath.split`. Quote notional is the specified amount when quote is specified, else `abs(CL quote delta)`.

Fee claims are minted as ERC-6909 on the hook during the swap (PM may not yet hold the quote ERC-20). `ReactorRouter` calls `hook.flush` **after** the swap unlock returns. Flush opens a new unlock, **burns 6909 then takes ERC-20**, and pays the token (2%), `FlywheelVault` (1%), and `BuybackVault` (0.5%). Calling flush inside the swap unlock fails (hook is not the locker).

Rewards: magnified DPS `MAG = 2**128` with per-account `magnifiedDividendCorrections`. Leftover magnified remainder `% eligibleSupply` is never allocated twice. No `outstanding <= backing + 1` slack.

Top-10: `finalizeEpoch` sorts qualifying TWAP mcap desc, fills at most 10 slots, snapshots `epochPot`. Second finalize no-ops. `executeTop10Buyback` marks `bought` before the swap. CORE is skipped. `#11` is not ranked.

## Lock

`ReactorLiquidityVault` is the `modifyLiquidity` caller (position owner). `liquidityDelta < 0` reverts `WithdrawDisabled`. No admin, no upgrade.

## Buyback

`core` is immutable. Route is a hookless CORE/quote pool set once by the deployer. Wrong-quote `execute` is a no-op (pending). `minCoreOut` + deadline + nonReentrant. CORE is burned to `0xdead`.

## Privileges

| Role | Power |
| --- | --- |
| Registry admin | Add/disable quotes, icons |
| Deployer (one-time binds) | `bindFactory`, `bindBuyback`, `configureRoute` |
| Anyone | Launch, bid, trade, claim, execute |
| Nobody | Withdraw LP, mint CORE/launch tokens, change 2/1/0.5, redirect CORE, blacklist |

## Trust assumptions

- Uniswap v4-core behaves as specified.
- Registry admin does not list fee-on-transfer or rebasing quotes.
- Frontend / indexer are not trusted for balances.
- BUSL allows this PoolManager deploy only as **non-production**.

## Limitations

- Official router is exact-in first. Exact-out is supported at the hook but less tested in the UI.
- First-buy rewards may sit in leftover until an eligible holder exists (then flush).
- No TWAP on buyback; caller sets slippage.
- Fair launch is CCA-inspired, not the Uniswap CCA factory (see ADR-002).
- Instant launch is not Uniswap InstantLaunchStrategy (see ADR-001).
- Local demo uses mock USDC-6, not Arc native gas USDC.

## Invariants (test-backed)

1. `holders + flywheel + core == floor-split 3.5%`
2. Transfer amount in == amount out
3. Token quote balance ≥ outstanding rewards (after flush)
4. Past rewards persist at zero balance
5. New holders do not inherit past accumulator (≤ 1 wei leftover dust)
6. PoolManager / vault / dead / zero excluded
7. Vault cannot remove liquidity
8. Fair bids do not accrue buyback
9. Finalize once
10. Hookless CORE swaps do not accrue REACTOR fees
11. Buyback CORE target immutable

## Commands

```bash
cd contracts && forge test
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

## Mainnet blockers

1. Uniswap v4-core BUSL-1.1 — no production deploy without Additional Use Grant or Change Date (2027-06-15).
2. No official PoolManager on Arc Testnet as of 2026-09-11; none on Mainnet (5042) yet.
3. No audit, no bug bounty, no formal verification.
4. Circle / Arc native USDC dual-decimal and blocklist semantics not fully reproduced on anvil.
5. InstantLaunchStrategy / CCA launcher stack not REACTOR-compatible.

## Highest risks

1. Hook custom-accounting sign errors
2. Reward solvency / leftover / 6-vs-18 decimals
3. CREATE2 hook bits
4. Buyback sandwich
5. Registry listing a hostile quote
