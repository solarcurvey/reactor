# AUDIT HANDOFF — REACTOR V1

**This software has not been audited.** Treat every contract as hostile-unreviewed. Do not deploy to Arc Mainnet (5042). No production claim. No Arc Public Testnet claim.

**Protocol release:** `0.1.0` (`v0.1.0`, `docs/version.json`). **Factory version:** V1 (`FACTORY_VERSION = 1`) — immutable, not the protocol semver.

**Documentation mandate:** any change to contracts, tokenomics, Factory, Guardian/Keeper, routing, launch admission, API, SDK, CORE, tickers, backend trust, or user-facing behavior must update the matching docs in the same commit. See `CONTRIBUTING.md` and `/docs/policy`. CI (`pnpm docs:check`) fails on drifted fees, 1B supply, 5% Dev Buy, 24h ticker lock, Factory labels, protocol version, or deployment tables. Never invent mainnet addresses.

**This pass (final Grok security/ops patch):** public `buyPrefunded` deleted; router-only `buyRouted` with this-call custody; production Safe ≠ deployer; RoutePlanner discovers proven venues; sell `minQuoteOut` ≠ `minFinalOut`; fee preview on official-market quote notional; Keeper executes frozen onchain epoch targets; lastGoodFdvQuote accepts 3 historical samples. Architecture and tokenomics unchanged.

## Codex first task (attack, do not build)

Treat `InstantCurve` + `UserRouteExecutor` as hostile. Reproduce a quote-inventory drain. Do not add features.

1. Confirm `buyPrefunded(address,address,uint256,uint256)` is absent (`cast sig` / ABI).
2. Call `buyRouted` as an EOA after an honest ZCAT/ZEC buy. Must revert `NotRouter`. `realQuote` and curve quote balance unchanged. Attacker ZCAT = 0.
3. Donate quote to InstantCurve, then try to consume it via `buyRouted` / any leftover-balance path. Must not mint.
4. Ride a malicious quote `transferFrom` callback during `buyRouted` to reenter `buy` / `buyRouted`. Must fail (`nonReentrant`).
5. Confirm Factory DevBuy cannot spend preexisting curve balances (pull + custody proof).
6. Second: `protocolExempt` latch — `ProtocolExemptReentrancy.t.sol`. Third: production Guardian — deployer cannot call Guardian ops.

Do not certify. Do not deploy. Do not propose a new curve or fee split.

## Codex focus (this amendment)

| Area | What to read | Attack tests |
| --- | --- | --- |
| **Prefunded drain (P0)** | `InstantCurve.buyRouted`, `_pullQuote`, `UserRouteExecutor.buy` | **`BuyPrefundedDrain.t.sol` — start here** |
| Router / adapters | `ReactorRouter` `swap`/`protocolSwap`/`addLiquidity` `nonReentrant`; `protocolExempt` latch | **`ProtocolExemptReentrancy.t.sol` (named malicious callback)** |
| Protocol exemption | Only sealed vaults + `ProtocolV4Adapter.protocolSwap`. User `swap` reverts `WalletExemptForbidden` if latch set | same + `ProtocolSettlement.t.sol` |
| Vault isolation | `FlywheelVault`, `BuybackVault`, `SelfBurnVault` — isolated pots, chunk/cooldown, returned amounts | `BlastRadius.t.sol`, `KeeperReturns.t.sol` |
| Keeper compromise | Designated only; `KEEPER_MODEL.md`; modes DRY_RUN/LOCAL/ARC_TESTNET; 5042 hard-disabled; no key logs | `GuardianP0.t.sol`, `keeper.ts` |
| Guardian | Immutable Safe in production; `setKeeper` / `setPricingSigner` / `setUsdPegOne` / pauses / adapters. No `setHook`. Never EOA-then-transfer | `SafeGenesis.t.sol`, `FrontrunBind.t.sol` |
| Rewards | Magnified DPS; genesis `eligible==0` → 2% SelfBurn (not first-holder rebate) | `RewardCampaign.t.sol`, `Token.t.sol` |
| Curve / ready / graduation | `_buy`/`_sell` revert `ReadyLocked`; `graduate` requires `ready` + revalidate | `CurveFreeze.t.sol` |
| Signed pricing | Unique digest: factory+creator+quote+virtualQuote0+curveConfig+salt+deadline+chain. No `pricingNonce` | `LaunchPricing.t.sol` concurrent + replay |
| Nested quotes | RoutePlanner max 3; ValuationEngine recursive; cycle reject; only usdPegOne is $1 | `valuation.test.ts`, `NativeQuote.t.sol` |
| CORE vest / genesis | 1B; 100M vest 30d cliff + 300d linear; 900M locked; never Top-10 | `CoreGenesis.t.sol`, `CoreLiquiditySim.t.sol` |
| Indexer / Top-10 | `block.timestamp` only; durable poolId→token; material vs irrelevant inactivity | `indexer.persist.test.ts`, `Top10Api.t.sol` |
| User routes | `UserRouteExecutor` + shared RoutePlanner; bonding nested USDC + graduated v4 | `UserRoute.t.sol` |
| Routing deltas | `RouteGuard`, `RouteExec`, adapters | `RoutingDeltas.t.sol`, `KeeperMinOut.t.sol` |

## Overview

REACTOR launches ERC-20s into Official REACTOR Pools: Uniswap v4 pools with `fee = 0`, `tickSpacing = 60`, and `ReactorHook`. The hook charges **3.5% of quote notional** via custom accounting (not an LP fee): 2% holders **or** SelfBurn, 1% Top-10 flywheel, 0.5% CORE buy+burn. Official **CORE/USDC** consolidates to **2.5% buy+burn + 1% flywheel** (no holder 2% — that would double-target CORE). Official **CORE/USDC** consolidates to **2.5% buy+burn + 1% flywheel** (no holder 2%). CORE is genesis 100M vest + 900M locked LP — not Instant, never Top-10.

**Instant** is bonding curve → ready → **frozen** (no buy/sell) → permissionless `graduate` → locked v4. Not single-sided v4 from trade #1. Protocol owns supply (1B / 18 dec), curve constants, start FDV, and the 2/1/0.5 split. Creator picks image / name / ticker / description / quote / Rewards vs Standard / optional Dev Buy ≤5% token-out (full 3.5%).

## Contract map

| Contract | Path | Notes |
| --- | --- | --- |
| `ReactorGuardian` | `contracts/src/ReactorGuardian.sol` | Immutable Guardian; replaceable Keeper; `pricingSigner`; pauses; adapters. No `setHook`. |
| `ReactorFactory` | `contracts/src/ReactorFactory.sol` | Instant + Batch Fair; priced launches for non-$1 quotes |
| `InstantCurve` | `contracts/src/InstantCurve.sol` | Virtual-reserve bonding; ready-lock; graduate revalidate. **No public prefunded buy.** `buyRouted` is UserRouteExecutor-only + this-call `transferFrom` custody |
| `LaunchPricing` | `contracts/src/libraries/LaunchPricing.sol` | Short-lived EIP-712 auth |
| `SelfBurnVault` | `contracts/src/SelfBurnVault.sol` | Standard 2% + Rewards genesis when eligible=0 |
| `FairClaimVault` | `contracts/src/FairClaimVault.sol` | Eligible holder of unclaimed auction tokens |
| `ReactorHook` | `contracts/src/ReactorHook.sol` | Official identity + fee; no bootstrap |
| `ReactorToken` | `contracts/src/ReactorToken.sol` | ERC-20 + O(1) rewards |
| `ReactorRouter` | `contracts/src/ReactorRouter.sol` | Unlock swaps / liquidity; sealed protocol vaults |
| `ReactorLiquidityVault` | `contracts/src/ReactorLiquidityVault.sol` | Lock-only LP owner |
| `BuybackVault` | `contracts/src/BuybackVault.sol` | Isolated 0.5% CORE pot; `burn()` only — no dead-address fallback |
| `FlywheelVault` | `contracts/src/FlywheelVault.sol` | Isolated 1% Top-10 pot |
| `UniswapV4Adapter` | `contracts/src/adapters/UniswapV4Adapter.sol` | User hops; fees apply; hookless / official REACTOR only |
| `ProtocolV4Adapter` | `contracts/src/adapters/ProtocolV4Adapter.sol` | Protocol vaults only; `protocolSwap`; not Keeper EOA / UserRoute |
| `RoutingRegistry` | `contracts/src/RoutingRegistry.sol` | View over Guardian-approved adapters |
| `QuoteAssetRegistry` | `contracts/src/QuoteAssetRegistry.sol` | External quotes Guardian-curated; native from graduation |
| `UserRouteExecutor` | `contracts/src/UserRouteExecutor.sol` | User USDC routing; **not** a protocol vault. Approves InstantCurve; never pre-credits quote |
| `TestCORE` | `contracts/src/TestCORE.sol` | Genesis mint 100M vest + 900M LP; `burn()`; no mint-all-to-deployer |
| `CoreVesting` | `contracts/src/CoreVesting.sol` | Immutable beneficiary; T0 launch; 30d cliff 0 then 300d linear |
| `CoreLiquidityVault` | `contracts/src/CoreLiquidityVault.sol` | Permanent single-sided CORE/USDC lock |
| `CoreBuybackExecutor` | `contracts/src/CoreBuybackExecutor.sol` | Only fee-exempt official CORE buy |
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

Only **usdPegOne** quotes (Guardian flag; initially canonical USDC) may use unsigned Instant geometry. Category.Stablecoins is **not** $1. EURC, ZEC, WBTC, native quotes require `instantLaunchPriced` / `launchStandardPriced` / `launchAndBuyPriced` with EIP-712 `LaunchPricingAuthorization`:

`factory, creator, quote, quoteDecimals, virtualQuote0, curveConfig, salt, deadline` + `chainId` in the digest.

Signer is `ReactorGuardian.launchSigner` (≠ Keeper ≠ Guardian Safe; Guardian may rotate). Domain is `TickerRegistry.domainSeparator`. Replay via `TickerRegistry.usedAuthorization[digest]`. **No per-quote serial nonce** — concurrent same-quote launches use unique `authId`. TTL ≤ 30 minutes. Creator must be `msg.sender`. EIP-712 binds the full immutable identity (ticker, name, metadata hash, quote, mode, virtualQuote0, curve, factory version). **No onchain ZEC/USD oracle** — the signature attests protocol curve constants for that quote’s decimals. ValuationEngine (offchain, multi-source + Arc sanity) produces `virtualQuote0`; if unreliable that quote launch is disabled.

Attack tests: expired / replay / wrong chain / factory / quote / creator / params / decimals / old signer after rotation / zero salt / concurrent / quarantine.

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
- v4 hooks: `address(0)` (hookless) or official REACTOR hook — no `setHook`, no arbitrary hooks
- Intermediate `hop.minOut == 0` reverts
- Keeper jobs require `minTargetOut` / `minOut` > 0 (SelfBurn, Top-10 final, CORE final). Sandwich between quote and exec → revert

`UserRouteExecutor` is a **separate** user router: USDC → hops → official quote → official pool → token (and reverse). `minFinalOut` + `deadline`. Callers that are protocol vaults revert. It cannot spend vault pots.

## Keeper blast radius

`MAX_CHUNK_BPS = 2000` (20%) + `KEEPER_COOLDOWN = 5 minutes` on Flywheel settle, SelfBurn, CORE / Buyback. Last-sweep: if leftover after chunk is below threshold, take remaining so pots can drain. Not 100% of a live pot in one call when remainder is still above threshold.

## Top-10

`apps/web/src/lib/marketdata.ts` **discovers** factory tokens on-chain (not env JSON):

- Graduated only; skip CORE
- Supply after burns (`totalSupply`)
- Official 10–15m VWAP/TWAP-like from indexed official trades (**chain `block.timestamp`**, never `Date.now()`)
- External quote USD: offchain multi-source + Arc sanity + staleness/deviation (`fuseExternalUsd6`). No onchain oracle
- Depth 3, cycle set, **$250k** floor
- Fail-closed **only** for MATERIAL uncertainty (prior ranked, last-good ≥ floor, liquidity, window volume). Thousands of dead low-value graduates with &lt;3 trades do **not** freeze the epoch

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
- UserRoute `sell` takes caller `minQuoteOut` on the official first-leg and `minFinalOut` on the USDC exit. Intermediate hop floors are caller-supplied (`RouteExec` rejects 0). Sandwich of the official pool reverts when those floors are set from a quote (`UserRoute.t.sol`).
- `launchAndBuy` unsigned path still uses internal curve `minOut=1` then checks the user `minOut` after.
- No TWAP on buyback; Keeper sets slippage.
- Fair launch is CCA-inspired, not the Uniswap CCA factory (ADR-002).
- Instant is not Uniswap InstantLaunchStrategy (ADR-001).
- Local demo uses mock USDC-6, not Arc native gas USDC.
- Keeper daemon submits `submitEpoch` on local Anvil 5042002 when the API is confident (Anvil #0 key). Other chains refuse broadcast unless `KEEPER_PRIVATE_KEY` is set. Watchdog reads heartbeat **and** on-chain `epochFinalized`.

## Invariants (test-backed)

1. `holders + flywheel + core == floor-split 3.5%` (or SelfBurn in place of holders)
2. Transfer amount in == amount out
3. Token quote balance ≥ outstanding rewards (after flush; no campaign slack)
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
6. Pricing-signer compromise authorizing a non-$1 curve with a wrong `virtualQuote0` (operational; no onchain USD oracle)
7. Offchain Top-10 / 10–15m VWAP window bugs (fail-closed only when a **material** candidate is unvalued)
8. **Codex: protocolExempt reentrancy** — latch + `nonReentrant` + `WalletExemptForbidden`. Named malicious token callback in `ProtocolExemptReentrancy.t.sol`
9. Intermediate nested-hop floors: `previewSettleQuote` / `previewTop10Hops` / `previewExecuteHops` revert with per-hop outs (`RouteExec.PreviewHops`). Keeper stamps each hop via `stampHopMinOuts`. Last-leg reuse is rejected. Tests: `HopFloors.t.sol`.

## §43 Self-audit (this pass)

| Check | Result |
| --- | --- |
| Signed `virtualQuote0` initializes InstantCurve | Yes — Factory passes verified auth; **usdPegOne only** unsigned |
| USD-equivalent geometry USDC/ZEC/WBTC/native | `LaunchPricing.t.sol` |
| Protocol nested settle fee-exempt | `ProtocolV4Adapter` + `ProtocolSettlement.t.sol` |
| User hops still pay 3.5% | same |
| UserRoute bonding + graduated USDC | `UserRoute.t.sol` |
| No `Guardian.setHook` | Removed; adapters hookless + official only |
| Top-10 10–15m VWAP, fail-closed unvalued | `marketdata.ts` / `top10.ts` |
| Keeper simulate→minOut→receipt, modes, no mainnet | `apps/indexer/src/keeper.ts` |
| Independent watchdog | `watchdog.ts` |
| CORE ticks / vest / burn / never Top-10 | `CoreLiquiditySim.t.sol` |
| QuoteAssetRegistry: no usdOracle / bounty fields | Cleaned |
| MarketOracle / KeeperReserve | Still deleted |
| No public mainnet | Chain 5042 hard-disabled |
