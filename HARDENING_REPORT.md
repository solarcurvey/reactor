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
| Reward accounting + stateful campaign | **MITIGATED** | Unit tests remain unit tests. `RewardCampaign.t.sol` is handler-based. Solvency slack tightened **1000 → 32 raw** after measuring gaps of 2 and 9 (see below). **Do not call this production-invariant-complete.** |

## Security tests (mapped)

Cross-quote flush, init frontrun, minOut=0, manipulated CORE spot, stale/cooldown ref, route unavailable, malicious quote, 6/8/18 decimals + multi-market, exact-in buy/sell, partial fill, slippage, hopping, transfer before/after fee, historic theft, double claim, wrong-pool/fake token/fake quote flush, fair early claimer, price discontinuity (auction Bps + sqrt from bids), repeat finalize, flash liquidity (negative lock), buyback reentrancy guard, quote→USDC→CORE hop, simultaneous ZCAT/GIGA/MEME — see `test/attack/Security.t.sol`, `CrossQuoteFlush.t.sol`, `Attacks.t.sol`, `Launches.t.sol`, `LockAndBuyback.t.sol`.

Stateful campaign: `forge test --match-path test/invariant/RewardCampaign.t.sol` (default 64 runs / depth 32).

## Reward solvency slack (Codex / residual)

`RewardCampaign` previously used `assertLe(outstanding, backing + 1_000)` after `+1` and `+8` failed. Those failures were:

| Slack tried | Counterexample | Gap (outstanding − backing) |
| --- | --- | --- |
| +1 | `500080 > 500078` | **2 raw** |
| +8 | `62359078 > 62359077` | **9 raw** |

**+1000 was not justified.** There is no 1000-unit hole. The gap is floor math:

- `PRECISION = 1e27`. `increment = (dist * PRECISION) / eligibleSupply` (floor).
- `leftover = dist - (increment * supply) / PRECISION` (the complementary remainder, ≥ 0).
- Holder pending uses `floor(bal * acc / PRECISION) - debt`.
- After each credit, `floor(bal * (acc+inc) / P) - floor(bal * acc / P)` can exceed `inc * bal / P` by **1 raw per holder**.
- Campaign outstanding = alice+bob+carol+fairVault pending + leftover. Backing = token quote balance + `hook.pendingTokenRewards` (credit is booked before ERC-20 lands).

Net observed excess is **2–9 raw**, not 1000. Slack is now **32 raw** (`SOLVENCY_SLACK_RAW`) with:

- `test_floorMathSlackIsFewRawUnits` — 400 tiny credits, odd supply, transfers + claim
- `test_swapPathRewardSlackIsFewRawUnits` — 36 buy/sell/flush/claim cycles on a live pool

**Residual risk for Codex:** the 32-raw bound is a **measured test ceiling**, not a proof. Phantom wei scales with (eligible holders × credits) in the worst case (`floor(x+y) ≤ floor(x)+floor(y)+1`). A later claimer can be short by a few wei if earlier claimers take the rounded-up pending. This is not an unbounded drain of user deposits (credits still equal lifetime 1:1). Shared-quote `_flush` caps 6909 at `pendingToken + pendingBuyback` for the flushed token; another token’s 6909 is not part of this slack. **Do not treat 32 as production-invariant-complete.**

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

**Status:** run pending this commit; results will be appended in the follow-up commit if the analyzer completes.

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
- Shared-quote 6909 flush + credit-before-physical-settle + per-holder reward floors leave a few raw units of slack (campaign slack **32**, measured max gap 9; previously widened to 1000 without math — tightened).
- Hook CREATE2 address moves when hook bytecode changes — always read `factory.hook()`.
- Frontend quotes via `simulateContract` (needs the wallet to have balances/allowance).
- No audit, no formal verification, no mainnet guardian, no pause (by design) — **hostile capital will try to steal or lock assets.**

## Intentionally not built

See `FUTURE.md`. No CCTP, no UBI SDK, no ArcPad SSE, no TOLLY terminal, no genuine CCA, no public testnet deploy in this pass.
