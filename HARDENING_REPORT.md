# HARDENING_REPORT

**Date:** 2026-09-11. **Not production ready. Not audited. No Arc Public Testnet or mainnet claim.**

Repo continued in place (HEAD started at `4d26bfe`). Cross-quote flush was **reproduced before the fix** (`test_reproduce_crossQuoteFlush_succeedsToday` on the two-arg API). After the fix that historical path reverts; the lock is `test_exploit_flushUsdcIntoZcat_mustRevert`.

## Differentiation shipped

UI and docs center **CHOOSE WHAT YOUR TOKEN EARNS** / **WHAT SHOULD YOUR TOKEN EARN?** Official pool: 0% LP / 3% REACTOR (2% holders in quote / 1% CORE). Token cards show **EARNS {QUOTE}** and **2% of official volume → holders**. Economics module: $1000 trade → $20 holders / $10 CORE. Batch Fair Launch is named honestly. TEST ASSET / TESTNET labels. No competitor trash-talk, no false first/only.

## P0 status

| Item | Status | Proof |
| --- | --- | --- |
| Cross-pool flush | **FIXED** | `flush(token)` + gated two-arg; `marketOfToken` from `afterInitialize`; router flushes launch token only. `test_exploit_flushUsdcIntoZcat_mustRevert`, `test_canonicalFlushPaysOnlyMatchingQuote`, `FlushFuzz.t.sol` |
| First-caller-wins bind | **FIXED** | Hook/vault binds are `owner`-gated and once-only. `test_initFrontrun_maliciousBinderFails` |
| Buyback minOut=0 / caller size | **FIXED** | `execute(quote)` only. Protocol minOut, chunk, reserve, cooldown, reference deviation. UI has no minCoreOut field. `test_minOutZeroReverts` (router), `test_manipulatedCoreSpotDoesNotDrain`, `test_staleRefAndCooldown` |
| Multi-quote CORE routing | **FIXED** | USDC direct; ZEC/BTC hop via USDC. Factory `canLaunch` requires buyback route. `test_decimals618AndMultiMarketBurn` |
| Real slippage | **FIXED** | Router `minOut==0` reverts. UI simulates then applies slippage. `test_slippageRevertAfterPriceMove` |
| Partial fills | **FIXED** | Exact-in `paid < want` → `IncompleteFill`. `test_partialFillRejectedAtInstantEdge` |
| Fair ≠ CCA | **FIXED** | Renamed Batch Fair Launch; `auctionBps==5000` locked. `test_fairAuctionBpsLockedAndPriceContinuity` |
| Fair reward ownership | **FIXED** | `FairClaimVault` eligible holder + O(1) `settleClaim`. `test_fairEarlyClaimerDoesNotSteal` |
| Reward accounting + stateful campaign | **FIXED** | Magnified DPS + corrections. Legacy over-assign reproduced in `RewardSolvency.t.sol`. Campaign has **no +1 slack**. Dust carries in `leftoverMagnified`. |
| 3.5% split | **SHIPPED** | 2% holders / 1% flywheel / 0.5% CORE. Pots isolated. CORE never Top-10. |

## Security tests (mapped)

Cross-quote flush, init frontrun, minOut=0, manipulated CORE spot, stale/cooldown ref, route unavailable, malicious quote, 6/8/18 decimals + multi-market, exact-in buy/sell, partial fill, slippage, hopping, transfer before/after fee, historic theft, double claim, wrong-pool/fake token/fake quote flush, fair early claimer, price discontinuity (auction Bps + sqrt from bids), repeat finalize, flash liquidity (negative lock), buyback reentrancy guard, quote→USDC→CORE hop, simultaneous ZCAT/GIGA/MEME — see `test/attack/Security.t.sol`, `CrossQuoteFlush.t.sol`, `Attacks.t.sol`, `Launches.t.sol`, `LockAndBuyback.t.sol`.

Stateful campaign: `forge test --match-path test/invariant/RewardCampaign.t.sol` (default 64 runs / depth 32).

## Reward solvency slack (Codex / residual)

`RewardCampaign` previously used `assertLe(outstanding, backing + 1_000)` after `+1` and `+8` failed:

| Slack tried | Counterexample | Gap (outstanding − backing) |
| --- | --- | --- |
| +1 | `500080 > 500078` | **2 raw** |
| +8 | `62359078 > 62359077` | **9 raw** |
| +32 (test widen) | isolated 400-credit fixture | **428 raw** (`test_floorMathSlackIsFewRawUnits`) |
| +32 (test widen) | 36-swap path | **35 raw** vs lifetime/backing |

**+1000 was not justified** and **+32 was not a safe ceiling**. The growth is `(eligible holders × unsynced credits)` wei in the worst case — a real over-assignment, not flush slack.

### Bug

Two compounding floor errors, **not** a 1000-unit flush hole:

1. **Cumulative acc.** `acc += (dist * P) / S` then leftover = `dist - (I * S) / P` conserves *per credit*, but `(S * ΣI) / P` can exceed `Σ((S * I) / P)` by ~1 raw per credit. Isolated 80-credit run: assigned 3398 vs lifetime 3320 (**+78**). 400 credits: **+428**. That is why +1 and +8 failed and +1000 “fixed” the campaign.

2. **Debt product.** `rewardDebt = floor(bal * acc / P)` then `unpaid = floor(bal * acc / P) - debt` lets `floor(bal*(acc+Δ)/P) - floor(bal*acc/P)` exceed `floor(bal*Δ/P)` by 1 raw per unsynced holder.

Last claimer reverts or is short when the view sum exceeds physical quote.

### Fix

- `_distributeDist` caps `acc` so `(S * acc) / P ≤ priorAssigned + dist` (leftover holds the remainder).
- `rewardDebt` is last synced `accRewardPerShare`; unpaid is `floor(bal * (acc - userAcc) / P)`.

Isolated fixture expects **0** over-assignment. Swap path / campaign keep **+1 raw** for credit-before-ERC-20.

### Residual risk for Codex

- View `rewardDebt(address)` is now an acc snapshot, not `floor(bal*acc/P)`. No mainnet; ABI selector unchanged.
- +1 campaign slack is still a test bound, not a proof. Shared-quote `_flush` caps 6909 at `pendingToken + pendingBuyback` for the flushed token — not part of this debt bug.
- Leftover + per-account floors can still leave **dust a last claimer cannot take** (transfer reverts if `stored > token quote balance`). Not an unbounded drain of other holders’ principal.
- **Do not call this production-invariant-complete.**

## Original review findings

| Finding | Status | Proof |
| --- | --- | --- |
| `flush(quote, token)` pays arbitrary ERC-20 against token pending | **FIXED** | QuoteMismatch / canonical flush |
| Public bindFactory/bindBuyback race | **FIXED** | owner + AlreadyBound |
| Permissionless `minCoreOut` / minOut=0 | **FIXED** | execute(quote); UI removed |
| Buyback failure reverting swaps | **NOT REPRODUCIBLE** as user-swap revert (already try/catch); **FIXED** for caller-supplied minOut |
| ZEC pending forever | **FIXED** via USDC hop (testnet mocks) |
| UI minOut=0 after quote | **FIXED** |
| Exact-out / partial unmarked | **FIXED** (exact-in only; incomplete revert) |
| Fair branded as CCA | **FIXED** (rename + 50/50 lock) |
| Early fair claimer steals | **FIXED** (FairClaimVault) |
| Unit tests labeled invariants | **FIXED** (campaign file + this report) |
| Arc Testnet success | **DEFERRED WITH REASON** — no dedicated funded key in this environment |
| Production ready | **DEFERRED** — never claimed |

## Test commands

```bash
export PATH="$PATH:$HOME/.foundry/bin"
cd contracts
forge fmt
forge build
forge test -vv
# frontend
pnpm --filter web typecheck || pnpm --filter web exec tsc --noEmit
pnpm --filter web lint
pnpm --filter web build
```

Slither: see **Static analysis (Slither)** below.

## Static analysis (Slither)

Install: `pip install slither-analyzer` (0.11.6 available in this environment: `~/.local/bin/slither`).

Command (from `contracts/`):

```bash
export PATH="$PATH:$HOME/.local/bin:$HOME/.foundry/bin"
slither src --exclude-dependencies --filter-paths lib
```

**Ran 2026-09-11.** `slither 0.11.6`. Exit 255 (findings present). `src` analyzed, 44 contracts, 102 detectors, **87 results**.

| Impact | Count | Detectors (top) |
| --- | --- | --- |
| High | 12 | unchecked-transfer 11, arbitrary-send-erc20 1 (`Router._handle` `transferFrom(payer,…)`) |
| Medium | 44 | unused-return 27, incorrect-equality 9, reentrancy-no-eth 6, divide-before-multiply 2 (`creditRewards` leftover — now also capped in `_distributeDist`) |
| Low | 28 | reentrancy-benign/events, missing-zero-check, timestamp (buyback cooldown / fair end) |
| Informational | 3 | low-level-calls (router flush try), missing-inheritance, unindexed-event-address |

No fabricated “clean” report. High/medium are mostly style (ignored ERC-20 bools on mocks/internal tokens, CEI event-after-call, `== 0` guards). **Not an audit.** Re-run after bytecode changes; hook CREATE2 will move.

Frontend: `pnpm exec tsc --noEmit` (target ES2020) and `pnpm lint` passed on `apps/web`. Dev server `http://127.0.0.1:43147` returned HTTP 200 after ABI restore.

Visual review (1440×900 and 390×844) is in `review/`. Home hero, Earn step, CORE TESTNET, and no caller minOut were confirmed. `/instant` is not a route — Instant is a step in `/launch`. No layout overflow found.

Local Anvil redeploy (hardening bytecode; **not** Arc Testnet):

| Contract | Address |
| --- | --- |
| Hook | `0x37e9b4b7dF06BbdfE6F7C3bb9F8DE909DB2470Cc` |
| Factory | `0xB0D4afd8879eD9F52b28595d31B441D079B2Ca07` |
| FairClaimVault | `0x7B6fCB97Fc1B74e16CBe577054a4426d3487837C` |

Always re-read `factory.hook()` after bytecode changes.

## Remaining risks / mainnet blockers

- Uniswap v4-core BUSL, non-production until June 2027; **no official v4 PoolManager on Arc Testnet** at last probe.
- Buyback reference is last-good spot, not a multi-block TWAP. First observation can be manipulated if the CORE pool is thin.
- Reward debt is acc-snapshot (fixed over-assignment). Campaign slack **1 raw**. Last claimer can still be short leftover dust. Previously +1000 was an unjustified widen.
- Hook CREATE2 address moves when hook bytecode changes — always read `factory.hook()`.
- Frontend quotes via `simulateContract` (needs the wallet to have balances/allowance).
- No audit, no formal verification, no mainnet guardian, no pause (by design) — **hostile capital will try to steal or lock assets.**

## Intentionally not built

See `FUTURE.md`. No CCTP, no UBI SDK, no ArcPad SSE, no TOLLY terminal, no genuine CCA, no public testnet deploy in this pass.
