# AUDIT HANDOFF — REACTOR V1

**This software has not been audited.** Treat every contract as hostile-unreviewed. Do not deploy to Arc Mainnet (5042). No production claim. No Arc Public Testnet claim.

**This pass (audit amendment):** ready-curve freeze, Keeper `minTargetOut` (no hardcoded 1/0), Guardian-only one-time binds, signed launch pricing, terminal fees on executed gross only, Rewards genesis → SelfBurn when `eligible==0`, hop balance deltas + hookless/REACTOR/approved hooks, Keeper blast radius, on-chain Top-10 discovery + Keeper daemon + independent watchdog, `UserRouteExecutor` (not a vault), CORE `burn()` only, dead V1 `MarketOracle` / `KeeperReserve` deleted.

## Codex focus (this amendment)

| Area | What to read | Attack tests |
| --- | --- | --- |
| Routing | `RouteGuard`, `RouteExec`, `UniswapV4Adapter` | `test/attack/RoutingDeltas.t.sol`, `KeeperMinOut.t.sol` |
| Vaults | `FlywheelVault`, `BuybackVault`, `SelfBurnVault` — isolated pots, chunk/cooldown, `minOut` | `BlastRadius.t.sol`, `Top10Security.t.sol` |
| Keeper | Designated only; `KEEPER_MODEL.md`; daemon does **not** broadcast | `GuardianP0.t.sol` |
| Guardian | Immutable; `setKeeper` / `setPricingSigner` / `setHook` / pauses / adapters | `FrontrunBind.t.sol`, `PRIVILEGE_MAP.md` |
| Rewards | Magnified DPS; genesis `eligible==0` → 2% SelfBurn (not first-holder rebate) | `RewardCampaign.t.sol`, `Token.t.sol` |
| Curve / ready | `_buy`/`_sell` revert `ReadyLocked`; `graduate` requires `ready` + revalidate | `CurveFreeze.t.sol` |
| Fees | Terminal / partial: fee on **executed gross** only; refund unexecuted + unearned fee | `CurveFreeze.t.sol`, `Curve.t.sol` |
| Signed pricing | EIP-712 `LaunchPricingAuthorization`; no onchain ZEC/USD oracle | `LaunchPricing.t.sol` |
| Nested quotes | Offchain discovery depth 3, cycle set, fail closed; $250k floor | `apps/web/src/lib/marketdata.ts` |
| User router | `UserRouteExecutor` — USDC↔token, official final/first leg, `minFinalOut`+deadline; cannot be a protocol vault | `UserRoute.t.sol` |

## Overview

REACTOR launches ERC-20s into Official REACTOR Pools: Uniswap v4 pools with `fee = 0`, `tickSpacing = 60`, and `ReactorHook`. The hook charges **3.5% of quote notional** via custom accounting (not an LP fee): 2% holders **or** SelfBurn, 1% Top-10 flywheel, 0.5% CORE buy+burn.

**Instant** is bonding curve → ready → **frozen** (no buy/sell) → permissionless `graduate` → locked v4. Not single-sided v4 from trade #1. Protocol owns supply (1B / 18 dec), curve constants, start FDV, and the 2/1/0.5 split. Creator picks image / name / ticker / description / quote / Rewards vs Standard / optional Dev Buy ≤5% token-out (full 3.5%).

## Contract map

| Contract | Path | Notes |
| --- | --- | --- |
| `ReactorGuardian` | `contracts/src/ReactorGuardian.sol` | Immutable Guardian; replaceable Keeper; `pricingSigner`; pauses; adapters; approved hooks |
| `ReactorFactory` | `contracts/src/ReactorFactory.sol` | Instant + Batch Fair; priced launches for non-$1 quotes |
| `InstantCurve` | `contracts/src/InstantCurve.sol` | Virtual-reserve bonding; ready-lock; graduate revalidate |
| `LaunchPricing` | `contracts/src/libraries/LaunchPricing.sol` | Short-lived EIP-712 auth |
| `SelfBurnVault` | `contracts/src/SelfBurnVault.sol` | Standard 2% + Rewards genesis when eligible=0 |
| `FairClaimVault` | `contracts/src/FairClaimVault.sol` | Eligible holder of unclaimed auction tokens |
| `ReactorHook` | `contracts/src/ReactorHook.sol` | Official identity + fee; no bootstrap |
| `ReactorToken` | `contracts/src/ReactorToken.sol` | ERC-20 + O(1) rewards |
| `ReactorRouter` | `contracts/src/ReactorRouter.sol` | Unlock swaps / liquidity; sealed protocol vaults |
| `ReactorLiquidityVault` | `contracts/src/ReactorLiquidityVault.sol` | Lock-only LP owner |
| `BuybackVault` | `contracts/src/BuybackVault.sol` | Isolated 0.5% CORE pot; `burn()` only — no dead-address fallback |
| `FlywheelVault` | `contracts/src/FlywheelVault.sol` | Isolated 1% Top-10 pot |
| `UniswapV4Adapter` | `contracts/src/adapters/UniswapV4Adapter.sol` | Hookless / official REACTOR hook / Guardian-approved hooks |
| `RoutingRegistry` | `contracts/src/RoutingRegistry.sol` | View over Guardian-approved adapters |
| `QuoteAssetRegistry` | `contracts/src/QuoteAssetRegistry.sol` | External quotes Guardian-curated; native from graduation |
| `UserRouteExecutor` | `contracts/src/UserRouteExecutor.sol` | User USDC routing; **not** a protocol vault |
| `TestCORE` | `contracts/src/TestCORE.sol` | Platform token, mint once; `burn(uint256)` |
| `MockERC20` | `contracts/src/MockERC20.sol` | Test quotes (open mint) |
| `PoolManager` | Uniswap v4-core | BUSL-1.1, non-production |

**Deleted from `/src` (git history keeps them):** `MarketOracle.sol`, `KeeperReserve.sol`.

Addresses: `deployments/local.json` (local demo). Hook CREATE2 **moves when hook bytecode changes** — read `factory.hook()`.

## Dependency commits

| Repo | Commit |
| --- | --- |
| Uniswap/v4-core | `e50237c43811bd9b526eff40f26772152a42daba` |
| Uniswap/v4-periphery (LiquidityAmounts, HookMiner pattern) | `dce236d4e2057422d0791d9a973a58765eb46f65` |
| foundry-rs/forge-std | `bf647bd6046f2f7da30d0c2bf435e5c76a780c1b` |
| Foundry toolchain | 1.8.1 (`982849d314`) |

Install: `cd contracts && forge install`.

## Hook permissions

```
BEFORE_INITIALIZE | AFTER_INITIALIZE | BEFORE_SWAP | AFTER_SWAP
| BEFORE_SWAP_RETURNS_DELTA | AFTER_SWAP_RETURNS_DELTA
= 0x30CC
```

`Hooks.validateHookPermissions` runs in the constructor. Test `test_hookBits` asserts `uint160(hook) & 0x3FFF == flags`.

## Curve ready / freeze

Preferred path: **terminal buy establishes exact terminal state → `ready` → frozen → permissionless `graduate`**.

- `_buy` / `_sell` revert `ReadyLocked` when `ready`.
- `graduate` requires `ready` (not “quote ≥ target”). Revalidates terminal reserves.
- Terminal buy clips to remaining-to-target (and inventory). Fees on **executed gross** only. `quoteIn - executedGross` refunded (unexecuted + unearned fee).
- Repeat `graduate` reverts. Sell after ready reverts. After graduate, trading is official v4.

Exploit: `test/attack/CurveFreeze.t.sol` — buy to threshold → ready → sell MUST revert → graduate → reserves reconcile. Also one-before, exact, oversized, sell before ready, no stranded inventory.

## Signed launch pricing

Non-$1 quotes (not USDC / not `Stablecoins`) require `instantLaunchPriced` / `launchStandardPriced` / `launchAndBuyPriced` with EIP-712 `LaunchPricingAuthorization`:

`factory, quote, quoteDecimals, virtualQuote0, nonce, deadline, chainId`

Signer is `ReactorGuardian.pricingSigner` (starts as Keeper; Guardian may rotate). Domain is the factory. Replay via `usedPricing` + per-quote `pricingNonce`. **No onchain ZEC/USD oracle** — the signature attests protocol curve constants for that quote’s decimals.

Attack tests: expired / replay / wrong chain (in-message) / factory / quote / params / decimals / old signer after rotation / nonce / quarantine.

Local UI: `POST /api/launch-pricing` signs with `PRICING_SIGNER_PK` (Anvil #0 fallback). Operational, not trustless.

## Fees / rewards

See `ECONOMICS.md` and `FeeMath.split`.

- Terminal / partial fills: fee **only** on actual executed gross quote. Refund all unexecuted including unearned fee.
- Rewards genesis: if `eligibleRewardSupply()==0`, the 2% goes to **SelfBurn** (curve `_payFees` and hook `_distribute`). Same rule for any later zero-eligible Rewards fee event. Not a rebate to the first holder.
- First Instant buy always hits this path (fees before token delivery). Later buys with eligible holders credit holders.

Flush: ERC-6909 during swap; `ReactorRouter` calls `hook.flush` after unlock. Flush burns 6909 then takes ERC-20.

## Routing

Every hop: real balance deltas in and out; next hop uses **actual** out, not adapter return. Malicious lying adapters fail (`RouteExec.DeltaOut` / `DeltaIn`).

- ≤ 3 hops, no cycles, no duplicate assets
- Adapter must be Guardian-approved
- v4 hooks: `address(0)` (hookless), official REACTOR hook, or `auth.hookApproved` — no arbitrary hooks
- Intermediate `hop.minOut == 0` reverts
- Keeper jobs require `minTargetOut` / `minOut` > 0 (SelfBurn, Top-10 final, CORE final). Sandwich between quote and exec → revert

`UserRouteExecutor` is a **separate** user router: USDC → hops → official quote → official pool → token (and reverse). `minFinalOut` + `deadline`. Callers that are protocol vaults revert. It cannot spend vault pots.

## Keeper blast radius

`MAX_CHUNK_BPS = 2000` (20%) + `KEEPER_COOLDOWN = 5 minutes` on Flywheel settle, SelfBurn, CORE / Buyback. Last-sweep: if leftover after chunk is below threshold, take remaining so pots can drain. Not 100% of a live pot in one call when remainder is still above threshold.

## Top-10

`apps/web/src/lib/marketdata.ts` **discovers** factory tokens on-chain (not env JSON):

- Graduated only; skip CORE
- Supply after burns (`totalSupply`)
- Official `extsload` slot0 sqrtPrice
- External quote → USD via hookless USDC hop or recursive native quotes
- Depth 3, cycle set, **$250k** floor, fail closed (pause epoch — never guess)

Keeper daemon (`apps/indexer/src/keeper.ts`) polls the API, writes a heartbeat, **logs** intended `submitEpoch` — it does not broadcast in this repo. Independent watchdog (`apps/indexer/src/watchdog.ts`) fail-closes on stale / pause.

Onchain `submitEpoch` checks **structure only**. Not a trustless oracle.

## Privileges

Every privileged function is **GUARDIAN** or **KEEPER** only. See `PRIVILEGE_MAP.md`.

| Role | Power |
| --- | --- |
| Guardian | Pauses, replace Keeper / pricing signer, adapters, hooks, external quotes, one-time binds |
| Keeper | settle / submitEpoch / Top-10 buy+burn / roll / CORE execute / SelfBurn execute — all with minOut + chunks |
| Anyone | Launch (priced if needed), bid, claim, curve buy/sell when open, graduate when ready, official swap, reward claim |
| Nobody | Withdraw LP, mint after construct, change 2/1/0.5, redirect CORE, blacklist, upgrade, wallet fee-exemption, dead-address CORE “burn”, first-caller bind |

There is no Ownable, admin, bootstrap, or first-caller-wins `bindFactory`.

## Trust assumptions

- Uniswap v4-core behaves as specified.
- Guardian does not list fee-on-transfer or rebasing quotes.
- Frontend / indexer / Top-10 API / pricing signer are **not** trusted for balances or USD.
- BUSL allows this PoolManager deploy only as **non-production**.
- Designated Keeper + pricing signer are operational keys. Compromise wastes a chunked pot or authorizes a non-$1 curve init — it cannot steal LP or rewrite fees.

## Limitations

- Official router is exact-in first. Exact-out exists at the hook but is less tested in the UI.
- UserRoute official sell first-leg uses a 1-wei floor; user protection is `minFinalOut` on the USDC exit.
- `launchAndBuy` unsigned path still uses internal curve `minOut=1` then checks the user `minOut` after.
- No TWAP on buyback; Keeper sets slippage.
- Fair launch is CCA-inspired, not the Uniswap CCA factory (ADR-002).
- Instant is not Uniswap InstantLaunchStrategy (ADR-001).
- Local demo uses mock USDC-6, not Arc native gas USDC.
- Keeper daemon does not submit txs in this repo (operator must wire a key).

## Invariants (test-backed)

1. `holders + flywheel + core == floor-split 3.5%` (or SelfBurn in place of holders)
2. Transfer amount in == amount out
3. Token quote balance ≥ outstanding rewards (after flush; campaign +1 raw slack)
4. Past rewards persist at zero balance
5. New holders do not inherit past accumulator
6. PoolManager / vault / dead / zero excluded
7. Vault cannot remove liquidity
8. Fair bids do not accrue buyback
9. Finalize once
10. Hookless CORE swaps do not accrue REACTOR fees
11. Buyback CORE target immutable; burn via `burn()`
12. Ready curve rejects buy and sell; graduate revalidates
13. One-time binds are Guardian-only
14. Lying adapters / arbitrary hooks fail

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
4. Keeper sandwich despite `minTargetOut` (operational key + quote-to-exec latency)
5. Registry listing a hostile quote
6. Pricing-signer compromise authorizing a non-$1 curve with wrong constants (decimals-scaled, still protocol formula)
7. Offchain Top-10 / nested quote graph bugs (fail-closed is the mitigation)
