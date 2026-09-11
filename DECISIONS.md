# DECISIONS — REACTOR Architecture Decision Records

Primary sources consulted 2026-09-11:

- [docs.arc.io](https://docs.arc.io) — RPC, chain id, USDC dual-decimal model, EVM differences, contract addresses
- [developers.uniswap.org](https://developers.uniswap.org) — v4 PoolManager, hooks, custom accounting, Instant Launch, deployments
- [github.com/Uniswap/v4-core](https://github.com/Uniswap/v4-core) @ `e50237c43811bd9b526eff40f26772152a42daba`
- [github.com/Uniswap/v4-periphery](https://github.com/Uniswap/v4-periphery) @ `dce236d4e2057422d0791d9a973a58765eb46f65`
- [github.com/Uniswap/liquidity-launcher](https://github.com/Uniswap/liquidity-launcher) InstantLaunchStrategy (Robinhood-only, hookless, native-ETH, fixed params)
- [github.com/Uniswap/continuous-clearing-auction](https://github.com/Uniswap/continuous-clearing-auction) factory v2.1.0 `0x000000001F26a0044BaA66024e7b6599c61963F8`

Live Arc Testnet probes (RPC `https://rpc.testnet.arc.io`):

| Check | Result |
| --- | --- |
| `eth_chainId` | `0x4cef52` = **5042002** |
| Native / ERC-20 USDC `0x3600…0000` | code present; `decimals() = 6`; `symbol() = USDC` |
| CCA factory `0x000000001F26a0044BaA66024e7b6599c61963F8` | **code present** |
| Canonical v4 PoolManager addresses (Ethereum `0x000000000004444c5dc75cB358380D2e3dE08A90`, Base `0x498581ff…`, Unichain `0x1F9840…0004`) | **empty** |
| Arc in official Uniswap v4 deployments list | **absent** |

---

## ADR-001 — Instant Launch uses a REACTOR strategy, not official InstantLaunchStrategy

**Status:** Accepted

**Context.** Official `InstantLaunchStrategy` (Uniswap Liquidity Launchpad) is documented as: hookless pool, native ETH quote only, 0.25% LP fee, 1e9/18-decimal token, fixed `initialTick` at strategy deploy, position locked in `FeeSplitter`. InstantLaunchStrategy official deployments currently appear Robinhood-only.

REACTOR requires: arbitrary curated ERC-20 quote, REACTOR hook from trade #1, **0% native LP fee**, 3% quote-side protocol charge, configurable starting valuation, optional paid dev buy, immutable `ReactorLiquidityVault`.

**Decision.** Implement `ReactorFactory.instantLaunch` that adapts Instant Launch *concepts* (full supply, single-sided concentrated position, market live immediately, locked LP) onto official REACTOR v4 pools. Do not call Uniswap InstantLaunchStrategy.

**Consequences.** Instant markets are Uniswap v4 from trade #1. No bonding-curve-then-migrate. Compatible with USDC-6 and mock quotes.

---

## ADR-002 — Batch Fair Launch (not CCA)

**Status:** Accepted (renamed 2026-09-11)

**Context.** CCA factory v2.1.0 **does** have bytecode on Arc Testnet. Official CCA + LiquidityLauncher migrate into hookless (or LBP-hook) pools with launcher-specific fee controllers. That path cannot produce an Official REACTOR Pool (hook + 0% LP fee + arbitrary quote + 3% quote-side accounting).

**Decision.** Ship **Batch Fair Launch** inside `ReactorFactory` — a pro-rata timed sale, **not** Uniswap CCA:

- `auctionBps` is hard-locked to **5000** (50% bidders / 50% official LP).
- Bids in the selected quote. **0% REACTOR charge during the sale.**
- Finalize once: official pool sqrtPrice is `LaunchMath.sqrtPriceFromFdv(token, quote, lpTokens, totalBids)` so the auction clearing price **is** the initial official price (tick rounding as in `TickMath`).
- Unclaimed auction tokens sit in `FairClaimVault` as an **eligible** holder (O(1) `settleClaim`). Early claimers do not steal later winners’ share.
- 3% economics begin only after `OfficialPoolCreated`.

**Consequences.** Auction UX matches the product (create → bid → finalize → MARKET LIVE). We do not pretend CCA factory output is a REACTOR official market. Revisit if Uniswap ships a hooked + ERC-20-quote Instant/CCA strategy on Arc.

**Follow-up (2026-09-11).** Router flush must run *after* `unlock` returns. Burn ERC-6909 before `take`. Hook address is CREATE2-mined and changes with hook bytecode.

---

## ADR-003 — Holder rewards are O(1) reward-per-share inside the launch token

**Status:** Accepted

**Context.** Brief requires claimable quote rewards without staking, persistence across transfers, zero transfer tax, exclude non-eligible balances, no O(n) holder loops.

**Decision.** Each `ReactorToken` stores `accRewardPerShare` and per-account `rewardDebt` / `storedRewards`.

- `rewardDebt[account]` is the last synced `accRewardPerShare`. Unpaid is `floor(bal * (acc - userAcc) / 1e27)`.
- `creditRewards` / leftover flush cap `acc` so `(eligible * acc) / 1e27` cannot exceed prior assigned + dist (naive `acc += dist * 1e27 / supply` over-assigns across credits).
- Eligible supply = `totalSupply - excludedBalance`.
- Excluded (immutable set at construction): `address(0)`, `0xdead`, `PoolManager`, `ReactorLiquidityVault`, `BuybackVault`, the token itself.
- Every transfer accrues sender and recipient, then re-syncs debt. No economic fee.
- `claim` pays stored quote. Rewards persist at zero balance.

**Consequences.** Constant-time accounting. New holders cannot steal past rewards (debt snaps to current accumulator). Documented seller-same-swap edge: hook credits rewards during `afterSwap` before ERC-20 settle, so a seller still holds at credit time.

---

## ADR-004 — Buyback accrues; execution is permissionless and not inside the swap

**Status:** Accepted

**Context.** 1% of quote notional must buy and burn TestCORE, but market-buying inside every swap is unsafe (reentrancy, manipulation, gas).

**Decision.** Hook forwards the 1% share to `BuybackVault.accrue`. Anyone may `execute(quote, amount, minCoreOut)` once `amount >= threshold` and `block.timestamp <= deadline`. Execution swaps only on the immutable hookless CORE/quote pool registered at vault construction, then burns CORE. No admin redirect of CORE target. If the route is missing or slippage fails, reserve stays pending.

**Consequences.** CORE pool is hookless so buyback cannot re-enter REACTOR 3% economics. Factory refuses to create an official market whose launch token or quote is CORE.

---

## ADR-005 — Deploy official Uniswap v4-core for non-production test use

**Status:** Accepted

**Context.** No PoolManager exists on Arc Testnet (probed + absent from Uniswap deployments). v4-core is **BUSL-1.1** until 2027-06-15, which grants copy/modify/redistribute and **non-production use**. Additional Use Grants live at `v4-core-license-grants.uniswap.eth`.

**Decision.** Deploy `PoolManager` from pinned v4-core for local Arc-compatible E2E and, if a funded testnet key exists, Arc Testnet **non-production** only. Display BUSL notice. **Do not deploy REACTOR or PoolManager to Arc Mainnet (5042).** Mainnet requires a license grant or the Change Date.

**Consequences.** Local and testnet loops use real v4 custom accounting. Production/mainnet is an explicit blocker in `AUDIT_HANDOFF.md`.

---

## ADR-006 — Hook collects a quote-side fee via beforeSwap + afterSwap return deltas

**Status:** Accepted

**Context.** Official v4 `afterSwap` may return a delta only in the *unspecified* currency. `beforeSwap` may return specified and unspecified deltas. A 3% fee that is **always quote** therefore cannot live in `afterSwap` alone.

**Decision.** Official LP fee is `0`. Hook flags: `AFTER_INITIALIZE | BEFORE_SWAP | AFTER_SWAP | BEFORE_SWAP_RETURNS_DELTA | AFTER_SWAP_RETURNS_DELTA`.

- Quote notional = absolute quote-side amount of the concentrated-liquidity swap (not the hook fee).
- If quote is the *specified* currency (exact-in buy, exact-out sell): `beforeSwap` returns a positive specified delta equal to 3%, so the swapper pays extra / receives less quote. CL swap size is unchanged.
- If quote is the *unspecified* currency (exact-in sell, exact-out buy): `afterSwap` takes 3% of the observed quote delta.
- Hook `take`s quote, splits 2% / 1%, credits token rewards and buyback vault.
- `beforeInitialize` allows only the factory (or its strategies) and requires `fee == 0` plus a registered quote.

**Consequences.** We do not pretend a 0% LP pool charges 3%. Frontend quotes all-in. External hookless pools are allowed and uncharged.

---

## ADR-007 — Liquidity is owned by an immutable vault with no withdraw

**Status:** Accepted

Official launch liquidity is minted with `ReactorLiquidityVault` as `modifyLiquidity` caller (v4 position owner = vault). The vault exposes lock/increase-only. No `removeLiquidity`, no NFT transfer, no admin, no upgrade.

---

## ADR-008 — Local Arc-compatible proof is the success path unless a funded testnet key appears

**Status:** Accepted

Arc Testnet RPC is live. We do not have Circle faucet credentials in this environment. Success is demonstrated on a local (or forked) chain with Arc chain id **5042002**, USDC-6 mock or forked USDC, and deployed v4 + REACTOR. **We will not claim Arc Testnet success** unless transactions land on `https://rpc.testnet.arc.io` and appear on `https://testnet.arcscan.app`.
