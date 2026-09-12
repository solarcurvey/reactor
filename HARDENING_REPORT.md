# HARDENING_REPORT

**Date:** 2026-09-11. **Not production ready. Not audited. No Arc Public Testnet or mainnet claim.**

Repo continued in place (this pass started at `844255e`). Public `InstantCurve.buyPrefunded` was **reproduced before the fix** (`test_reproduce_buyPrefunded_drainsAliceQuote` on HEAD 844255e: attacker with 0 ZEC minted ZCAT and inflated `realQuote` against Alice's inventory). After the fix that selector is gone; the lock is `BuyPrefundedDrain.t.sol`.

## Differentiation shipped

UI and docs center **CHOOSE WHAT YOUR TOKEN EARNS** / **WHAT SHOULD YOUR TOKEN EARN?** Official pool: 0% LP / 3% REACTOR (2% holders in quote / 1% CORE). Token cards show **EARNS {QUOTE}** and **2% of official volume → holders**. Economics module: $1000 trade → $20 holders / $10 CORE. Batch Fair Launch is named honestly. TEST ASSET / TESTNET labels. No competitor trash-talk, no false first/only.

## P0 status

| Item | Status | Proof |
| --- | --- | --- |
| Cross-pool flush | **FIXED** | `flush(token)` + gated two-arg; `marketOfToken` from `afterInitialize`; router flushes launch token only. `test_exploit_flushUsdcIntoZcat_mustRevert`, `test_canonicalFlushPaysOnlyMatchingQuote`, `FlushFuzz.t.sol` |
| First-caller-wins bind | **FIXED** | Guardian-only, once. No Ownable/bootstrap. `FrontrunBind.t.sol` |
| Buyback minOut=0 / caller size | **FIXED** | `execute(quote)` only. Protocol minOut, chunk, reserve, cooldown, reference deviation. UI has no minCoreOut field. `test_minOutZeroReverts` (router), `test_manipulatedCoreSpotDoesNotDrain`, `test_staleRefAndCooldown` |
| Multi-quote CORE routing | **FIXED** | USDC direct; ZEC/BTC hop via USDC. Factory `canLaunch` requires buyback route. `test_decimals618AndMultiMarketBurn` |
| Real slippage | **FIXED** | Router `minOut==0` reverts. UI simulates then applies slippage. `test_slippageRevertAfterPriceMove` |
| Partial fills | **FIXED** | Exact-in `paid < want` → `IncompleteFill`. `test_partialFillRejectedAtInstantEdge` |
| Fair ≠ CCA | **FIXED** | Renamed Batch Fair Launch; `auctionBps==5000` locked. `test_fairAuctionBpsLockedAndPriceContinuity` |
| Fair reward ownership | **FIXED** | `FairClaimVault` eligible holder + O(1) `settleClaim`. `test_fairEarlyClaimerDoesNotSteal` |
| Reward accounting + stateful campaign | **FIXED** | Magnified DPS + corrections. Legacy over-assign reproduced in `RewardSolvency.t.sol`. Campaign has **no +1 slack**. Dust carries in `leftoverMagnified`. |
| 3.5% split | **SHIPPED** | 2% holders / 1% flywheel / 0.5% CORE. Pots isolated. CORE never Top-10. |
| Public buyPrefunded drain | **FIXED** | Deleted. `buyRouted` pulls from bound `UserRouteExecutor` via `transferFrom` + this-call balance proof. No prefunded flag. Factory DevBuy and `buyWithUsdc` also pull/measure. `BuyPrefundedDrain.t.sol` |
| Production Guardian Safe | **SHIPPED** | Constructor starts `launchesPaused`. `SAFE_GENESIS` deploys constructors only. Safe MultiSend (`SafeGenesisBatch.s.sol`) then `VerifyGenesis`. Deployer ≠ Guardian. `SafeGenesis.t.sol` |

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

Isolated fixture, swap path, and campaign assert **0** over-assignment (`outstanding <= backing`). Leftover magnified remainder is unassigned carry-forward, not slack.

### Residual risk for Codex

- View `rewardDebt(address)` is now an acc snapshot, not `floor(bal*acc/P)`. No mainnet; ABI selector unchanged.
- Campaign invariant is `outstanding <= backing` with **no slack**. That is a Foundry campaign bound (64 runs / depth 32), not a formal proof. Shared-quote `_flush` caps 6909 at `pendingToken + pendingBuyback` for the flushed token — not part of this debt bug.
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

**Last slither note (stale count).** Re-run after this amendment. `MarketOracle` and `KeeperReserve` were **deleted** from `/src`. Do not quote the 142-result row as current.

| Impact | Count | Detectors (top) |
| --- | --- | --- |
| High | 16 | unchecked-transfer 15, arbitrary-send-erc20 1 (`Router._handle` `transferFrom(payer,…)`) |
| Medium | 64 | unused-return 40, incorrect-equality 11, reentrancy-no-eth 8, uninitialized-local 5 |
| Low | 54 | reentrancy-benign 15, reentrancy-events 12, missing-zero-check 16, timestamp 9, costly-loop 1 (`finalizeEpoch` over `allTokens`) |
| Informational | 8 | low-level-calls, missing-inheritance (`IFeeSink` on vaults), redundant-statements, unindexed-event-address |

No fabricated “clean” report. High/medium are mostly style (ignored ERC-20 bools on mocks/internal tokens, CEI event-after-call, `== 0` guards). **Not an audit.** Re-run after bytecode changes; hook CREATE2 will move.

Frontend: `pnpm exec tsc --noEmit` (target ES2020) and `pnpm lint` passed on `apps/web`. Dev server `http://127.0.0.1:43147` returned HTTP 200 after ABI restore.

Visual review (1440×900 and 390×844) is in `review/`. Instant is a **single compact form** — no creator FDV slider, no multi-step wizard. Token page shows bonding % vs Official v4. `/reactor` is THE REACTOR (on-chain discovery API). Quote ecosystem pages at `/quote/{symbol}`.

## Repo-wide custody / skip-transfer search (this pass)

Searched: `prefunded`, `alreadyTransferred`, `prepaid`, `skipTransfer`, `transferAlreadyDone`, `creditFromBalance`, `consumeBalance`, `depositThenCall`.

| Location | Verdict |
| --- | --- |
| `InstantCurve.buyPrefunded` + `_buy(..., prefunded)` | **DELETED**. Replaced by `buyRouted` + `_pullQuote` |
| `InstantCurve.launchDevBuy` | **HARDENED**. Factory approves; curve pulls + custody proof |
| `InstantCurve.buyWithUsdc` | **HARDENED**. Measures this-call quote balance increase after hop |
| `UserRouteExecutor.buy` | **HARDENED**. Approves curve; no pre-transfer of quote |
| `ReactorFactory` DevBuy | **HARDENED**. Pull to factory, approve curve, no push-to-curve |
| `ReactorLiquidityVault` "tokens already sit here" | Graduation lock only — not a public buy |
| `FairClaimVault` "quote already" | Pro-rata claim of auction proceeds — not a skip-transfer buy |
| Adapters / router / CORE | All `transferFrom` the caller |

No remaining public trust-by-prefunding entrypoint.

## Audit amendment (this pass)

| Item | Status | Proof |
| --- | --- | --- |
| Ready-curve freeze | **FIXED** | `ReadyLocked` on buy/sell; graduate revalidates. `CurveFreeze.t.sol` |
| Keeper minOut 1/0 | **FIXED** | `minTargetOut` required. `KeeperMinOut.t.sol` |
| First-caller binds | **FIXED** | Guardian-only. `FrontrunBind.t.sol`, `PRIVILEGE_MAP.md` |
| Signed launch pricing | **SHIPPED** | `LaunchPricing.t.sol` |
| Terminal fees on executed gross | **SHIPPED** | InstantCurve refund path |
| Rewards genesis → SelfBurn | **SHIPPED** | `eligible==0` |
| Hop deltas + hook allowlist | **SHIPPED** | `RoutingDeltas.t.sol` |
| Blast radius 20% + cooldown | **SHIPPED** | `BlastRadius.t.sol` |
| Top-10 discovery API | **SHIPPED** | `marketdata.ts` — not env JSON |
| UserRouteExecutor | **SHIPPED** | `UserRoute.t.sol` |
| CORE `burn()` only | **SHIPPED** | dead-address fallback removed |
| Dead V1 oracle/reserve | **DELETED** | git history only |
| CORE genesis 10/90 | **SHIPPED** | Not Instant. Vest 100M + locked 900M official CORE/USDC. 2.5/1.0 book. `CoreGenesis.t.sol` §28 + `CoreInvariant.t.sol` §29 |

Local Anvil redeploy (hardening bytecode; **not** Arc Testnet):

| Contract | Address |
| --- | --- |
| Hook | `0x37e9b4b7dF06BbdfE6F7C3bb9F8DE909DB2470Cc` |
| Factory | `0xB0D4afd8879eD9F52b28595d31B441D079B2Ca07` |
| FairClaimVault | `0x7B6fCB97Fc1B74e16CBe577054a4426d3487837C` |

Always re-read `factory.hook()` after bytecode changes.

## P1 web metadata / CSP (this amendment)

| Item | Status | Proof |
| --- | --- | --- |
| Untrusted name/ticker/description rendered as HTML | **FIXED** | Strip tags/bidi/controls. No `dangerouslySetInnerHTML`. `untrusted-metadata.test.ts` |
| `javascript:` / `data:` website, social, image | **FIXED** | Scheme allowlist + host allowlist. Admission **DENY**. UI sanitizes on read |
| Arbitrary remote images / SVG XSS | **FIXED** | Media allowlist `/m/<id>.webp` + `/icons/`. `SafeTokenImage` + `referrerPolicy=no-referrer` |
| Missing production CSP | **FIXED** | Middleware nonce CSP — production `script-src` is `'nonce-…' 'strict-dynamic'` (no `'unsafe-inline'`). Static headers still `launchpadSecurityHeaders()`. HSTS only `REACTOR_ENV=PROD` |
| CSP only asserted in source | **FIXED** | `pnpm test:web-security` hits live `next start` headers |
| Secrets in `NEXT_PUBLIC_*` / client chunks | **FIXED** | `secret-sentinel.test.ts` + `scan-client-bundle.ts` |
| Metadata steers wallet tx | **FIXED** | `tx-guard.ts` — chain mismatch hard-blocks; indexer `tx` discarded |
| Long / bidi / invisible layout | **FIXED** | `UntrustedText` isolate + wrap; Playwright corpus |
| Media GET sniffable as HTML | **FIXED** | `/m/` nosniff + `default-src 'none'; sandbox` |

Economics / 3.5% / Factory V1 / no mainnet: unchanged.

## P1 geo policy (#63)

| Item | Status | Proof |
| --- | --- | --- |
| One server ALLOW / DENY / UNKNOWN interface | **SHIPPED (policy only)** | `evaluateGeoPolicy` / `evaluateRequestGeo` |
| Browser country / IP headers trusted | **REJECTED** | Unsigned `CF-IPCountry` / `X-Country` → `UNKNOWN_UNTRUSTED_SOURCE` |
| Versioned deny revision + source/date | **SHIPPED** | `geo-policy-us-comprehensive.v1.json` |
| Region fail-closed without metadata | **SHIPPED** | UA without ISO 3166-2 → `UNKNOWN_REGION_METADATA_UNAVAILABLE` |
| Whole-oblast Donetsk/Luhansk DENY | **REJECTED** | `UA-14` / `UA-09` / oblast names → UNKNOWN (FAQ 1009). DENY only `UA-DPR` / `UA-LPR` or precise DPR/LPR names |
| VPN/Tor invented as certain | **REJECTED** | `confidence: "best_effort"` only; Tor → UNKNOWN |
| LOCAL loads production deny list | **REJECTED** | Fixture `FX`/`FY`; `GEO_DENY_COUNTRIES` ignored |
| HTTP enforcement / UX / SDN | **OUT OF SCOPE** | #62 / #65 / #61 |

## P1 API body limits (this amendment)

| Item | Status | Proof |
| --- | --- | --- |
| Public JSON POSTs unbounded buffer | **FIXED** | Stream 16KiB default / 64KiB hard max on `/quote`, `/launch/admit`, `/launch/authorize`. Content-Length **and** chunked. Env cannot raise past hard max. 413 + destroy. `read-json-body.test.ts` |
| Next BFF `/api/launch-pricing` | **FIXED** | Same 16KiB default / 64KiB hard max before proxy. `limited-json.test.ts` |
| Isolated signer unbounded parse | **FIXED** | Same reader (not a public API) |
| Upload 2MB | Unchanged | Already streamed |

## Remaining risks / mainnet blockers

- Uniswap v4-core BUSL, non-production until June 2027; **no official v4 PoolManager on Arc Testnet** at last probe.
- Buyback reference is last-good spot, not a multi-block TWAP. First observation can be manipulated if the CORE pool is thin.
- Reward debt is acc-snapshot (fixed over-assignment). Campaign asserts `outstanding <= backing` with no slack. Last claimer can still be short leftover dust. Previously +1000 was an unjustified widen.
- Hook CREATE2 address moves when hook bytecode changes — always read `factory.hook()`.
- Frontend quotes via `simulateContract` (needs the wallet to have balances/allowance).
- No audit, no formal verification, no mainnet guardian, no pause (by design) — **hostile capital will try to steal or lock assets.**

## Intentionally not built

See `FUTURE.md`. No CCTP, no UBI SDK, no ArcPad SSE, no TOLLY terminal, no genuine CCA, no public testnet deploy in this pass.
