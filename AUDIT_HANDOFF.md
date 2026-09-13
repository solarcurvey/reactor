# AUDIT HANDOFF — REACTOR V1

**This software has not been audited.** Treat every contract as hostile-unreviewed. Do not deploy to Arc Mainnet (5042). No production claim. No Arc Public Testnet claim.

**Protocol release:** `0.1.0` (`v0.1.0`, `docs/version.json`). **Factory version:** V1 (`FACTORY_VERSION = 1`) — immutable, not the protocol semver.

**Documentation mandate:** any change to contracts, tokenomics, Factory, Guardian/Keeper, routing, launch admission, API, SDK, CORE, tickers, backend trust, or user-facing behavior must update the matching docs in the same commit. See `CONTRIBUTING.md` and `/docs/policy`. CI (`pnpm docs:check` in `.github/workflows/ci.yml` job `constants-version-deployments`) fails on drifted fees, 1B supply, 5% Dev Buy, 24h ticker lock, Factory labels, protocol version, or deployment tables. `pnpm docs:links` (same `test:lib` path, plus full-only job `docs-links`) fails on broken in-repo `/docs` slugs and relative files. Never invent mainnet addresses.

**This amendment (full GitHub CI extras, Refs #17, merged #42):** leftover #17 gates land on the #69 three-tier `ci.yml` — not a second workflow. `docs:links`, `scripts/safe-genesis-builder.test.ts`, and `page-budget.test.ts` are in `test:lib`. Playwright smoke + interactive is full-only job `web`. Always-on `page-budget` stays required by `ci-ok`. Foundry Attack / CREATE2 / size-guard, Postgres, production Next security, and live-toasts stay on the #73 jobs. A skipped job is not a pass. Accepted evidence: merge-candidate `11fdadb` / [`34727535121`](https://github.com/solarcurvey/reactor/actions/runs/34727535121), post-merge `80d3cac` / [`34727638255`](https://github.com/solarcurvey/reactor/actions/runs/34727638255). **#17 stays open** until #79 post-merge docs/CI. Architecture and tokenomics unchanged. See `/docs/ci` and `BUILD_REPORT.md`.

**This amendment (sanctions ops #64):** official-list freshness SLA, last-known-good refresh, minimized policy audit, `sanctions_*` alerts, and the operator runbook (linked from incident response). Official `#61` refresh binds when `apps/indexer/src/sanctions.ts` is present (merged via #66). Rebased onto `35552f6` after **#79** (#17 evidence docs) and **#68** (#62) and **#67** (#63 geo). Independent audit (2026-09-12): gated identity is the merged #62 recovered EIP-191 subject (`operator-policy.ts`), not the wallet-proof fallback; fixture refresh is LOCAL/test-only. Independent audit (2026-09-13): same-address refresh persists a new #61-style source-generation so `retrievedAt` survives `loadFromDisk`. LOCAL official-store bind loads pinned `#61` OFAC XML (no live treasury.gov unless `SANCTIONS_NETWORK=1`) so the `#62` HTTP matrix sees current freshness. Architecture and tokenomics unchanged. Issue **#64 stays open**.

**This amendment (restricted-access UX, Refs #65 / parent #60):** public launchpad `/restricted` + disabled Confirm / Launch / Quote / bid / claim CTAs when the hosted operator-policy decision is deny or unavailable. Neutral account / location / temporary copy. Browser JSON is the minimized public view only (no raw IP, screening-entry metadata, list UIDs, dataset hashes). Official decision read is `GET /operator-policy/status` (`readOperatorPolicyStatus` / `evaluateOperatorPolicy`). `GET /operator-policy/challenge` is a signing helper only. Subject is the EIP-191 signer (`x-reactor-wallet-proof`). Official **#61 / #62 / #64** plugins are on `main` via **#66 / #68 / #70**. Disclosure matches merged #64: 7-day official-list SLA, stale/missing never treated as clear, last-known-good on the operator side, no complaint auto-override, exact-list matching is not hop analytics. Geo core is on `main` via **#67**; founder **reopened #63** until this user-visible restricted state lands. Production `next build`/`next start` matrix covers blocked wallet / geo / stale / allow on desktop and 390px plus the real #62 write-gate bypass. Does not pause or censor immutable public contracts. Architecture and tokenomics unchanged. **#65 and #63 stay open.**

**This amendment (production UI E2E, Refs #35 / Refs #15, squash-merged #44 / `b190e86`):** Playwright against `next build`/`next start` with a deterministic EIP-1193 fixture and a MetaMask/Rabby-style MV3 extension (Anvil #0/#1 addresses only — no mainnet keys). Desktop + iPhone-class + narrow-Android. Shared `console.error` / `pageerror` teardown gate. Mock indexer serves #50 `/quote-assets`, `/markets/:token`, `/page/token/:token` and #68 `/operator-policy/challenge` + `/operator-policy/status`. EIP-1193 `rejectTx` is `eth_sendTransaction` only. Folded as full-only job `e2e-release-gate` on `.github/workflows/ci.yml` (no separate `e2e-release.yml`). Continues landing the gate for #15. Do not `Fixes` / `Closes` #35 or #15. Architecture and tokenomics unchanged.

**This amendment (operator policy gate, Refs #62):** one shared offchain `evaluateOperatorPolicy` / `gateProtectedWrite` on REACTOR-operated write/authorization HTTP (`/launch/admit`, `/launch/authorize`, isolated signer, `/quote`, `/upload`, Next `/api/launch-pricing`). The screened subject is the EIP-191 recovered signer of `GET /operator-policy/challenge` — not `body.wallet` / `x-reactor-wallet`. Independent audit on PR #68: claimed-wallet / `x-reactor-wallet` is not authority; CORS no longer permits that header; `/upload` requires the recovered proof. `GET /operator-policy/status` is the official minimized decision read for #65 / PR #75 (same reasons; no wallet/IP/SDN). Address screen binds merged `#66` `indexerSanctionsStore().screen` (`GET /sanctions/screen` stays the lookup API). Trusted geo binds merged `#67` `evaluateRequestGeo`. Fail closed on blocked recovered wallet, blocked geo, missing/invalid proof, or required-policy unavailable/stale. Quote recipient and launch creator are rebound to the recovered signer. Public GET market/docs (including `/sanctions/screen`) are not gated. Immutable contracts remain callable onchain. Guardian gains no economics or seize power. Tokenomics unchanged. Issue **#62 closed** after #68 `2002aed` / [`34733128955`](https://github.com/solarcurvey/reactor/actions/runs/34733128955). Parent **#60** and **#64 / #65** stay open.

**This amendment (geo policy #63, merged #67 / `e712617`):** offchain `evaluateRequestGeo` (ALLOW / DENY / UNKNOWN) over a verified reverse-proxy HMAC and versioned `geo-policy-us-comprehensive.v1.json` **revision 3**. Browser country headers are ignored. LOCAL fixtures cannot activate the production deny revision. E.O. 14065 oblast codes `UA-14` / `UA-09` are UNKNOWN (OFAC FAQ 1009), not whole-oblast DENY; DENY only on signed covered-region `UA-DPR` / `UA-LPR` or precise DPR/LPR names. `SY` is not blanket-denied. HTTP write enforcement is #62. Not SDN screening, not a legal opinion. Core layer accepted on post-merge [`34731788819`](https://github.com/solarcurvey/reactor/actions/runs/34731788819). Issue **#63 reopened** until #65 user-visible restricted state via PR #75. Architecture and tokenomics unchanged.

**This amendment (exact official-list screening, Refs #61 / parent #60, merged #66 `d08aa1c`):** `@reactor/sanctions` parses pinned OFAC-shaped SDN/consolidated XML fixtures and can refresh official Treasury HTTPS lists atomically. `screen()` / `GET /sanctions/screen` returns `blocked` | `clear` | `unavailable` plus dataset version — never a boolean that treats errors as clear. Fixtures ride `pnpm test:lib` beside #42 `docs:links` / Safe genesis and #50 `page-budget`. **Not legal/OFAC compliance. No hop/exposure attribution. Not a launch/trade policy gate** (later #60 children). **#61 closed** after [`34731099571`](https://github.com/solarcurvey/reactor/actions/runs/34731099571). **#60 / #64 / #65 stay open.** Architecture and tokenomics unchanged. Do not treat this as a protocol change.

**This amendment (CI cost, Refs #69, landed #73 on main `300b7e5`):** GitHub Actions is three-tier (fast PR / full merge-candidate / main). Feature-branch `push` no longer duplicates `pull_request`. `keeper-lease-pg` is folded into `postgres-ms-timestamps`. Required commands are unchanged in substance (`test:lib`, `test:web-security`, `test:live-toasts`, `test:pg` + `test:pg-lease`, Foundry on full/main). A skipped job is not a pass. Architecture and tokenomics unchanged. See `/docs/ci`.

**This amendment (repo publicization / history rewrite, Refs #72):** founder-authorized `git filter-repo` remap of personal-mailbox `Co-authored-by` trailers to GitHub noreply. Pre-rewrite `main` `c15956196418baca76280b9c6d98c11f3cbb24c9` → rewritten `a56065016731ac9af93b3aaec0bd896a94cc3397`; #74 squash-merged at `6b328373650722df480e744da26dbb6f4cfb7386`. Open PR heads force-updated; merged/superseded `cursor/*` leftovers deleted. Visibility stays **private**. Full-history gitleaks/trufflehog after rewrite: 0 live credentials (fixtures only). Public-fork Actions remain `contents: read` + `persist-credentials: false` on the #69 `ci.yml` fold; no `pull_request_target`. Founder decision (Davis): Support purge/GC of pre-rewrite dangling SHAs is **not required**. Residual old-SHA exposure is an accepted residual / non-blocking. AC1 is email scrubbed from **advertised** refs only (`main`, active PR heads, intentional tags). Architecture and tokenomics unchanged. Re-audit `/docs/publicization` immediately before any visibility change; do not treat this as a protocol change.

**Prior amendment (CI lease flake after #47):** indexer `leader_locks` unit / `test:pg-lease` TTL cases inject `leaseNow()` + a renew scheduler (`apps/indexer/src/lease-clock.ts`). Production still uses `Date.now()` + `setInterval`. Acquire / renew / fence SQL is unchanged. Architecture and tokenomics unchanged. Re-audit the offchain test harness if the prior Keeper lease review is in scope; do not treat this as a protocol change.

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
| Indexer / Top-10 | Indexed markets + ValuationService snapshot (`GET /top10`); 15m snapshot TTL shared with Keeper; indexed `quote_lp` liquidity; no mint-supply fallback. Event journal schema v8. `tokens.current_supply` is schema **v9** (#23). `external_price_marks.kind` is schema **v10** (#30). Top-10 candidate tables are schema **v11**. Arc sanity mark is on `route_venues.last_price_quote_x18` (column-gated, not a new migration id). Offchain ms columns are `BIGINT` (schema v6) | `top10-rank.test.ts`, `packages/reactor/src/top10.test.ts`, `ingest.valuation.test.ts`, `price-marks.test.ts`, `tick-atomic.test.ts`, `schema.test.ts`, `pg-ms-timestamps.test.ts`, `Top10Api.t.sol` |
| Indexer markets / candles | Keyset cursor matches `sort`; candle gap-fill ≤ `limit` (max 1000); exclusive `before`; `listMarkets` projects `current_supply`. `GET /markets/:token` + `GET /page/token/:token` aggregate display rows only — not a live quote | `markets-query.test.ts`, `page-reads.test.ts`, `prices.test.ts` |
| Read-path budgets (#37) | Board/search/token/Launch/Rewards/REACTOR/CORE/quote/wallet stay O(1) or O(page) on a 4k-market seed. SSE patches, does not invalidate the board. No refetch-on-focus for expensive reads. Live `POST /quote` stays 30s fail-closed. Required always-on CI job `page-budget` in `.github/workflows/ci.yml` (`ci-ok` requires success). **#37 closed** after #50 `e5fd745` / [`34727279555`](https://github.com/solarcurvey/reactor/actions/runs/34727279555). | `page-budget.test.ts`, `indexed.test.ts`, `rpc-batch.test.ts`, `.github/workflows/ci.yml` |
| Public JSON body caps (P1) | Stream 16KiB default / 64KiB hard max on `/quote`, `/launch/admit`, `/launch/authorize` (chunked included; env cannot disable). Upload remains 2MB. | `read-json-body.test.ts` |
| Live buy+burn toasts | SSE after persist commit. First `hello.head` skips history; reconnect `?after=` must not raise cutoff. Dedupe `(chainId, tx, logIndex, eventKind)` survives dismiss. Hover/focus pause; safe-area; reduced-motion. Visible CI gate `live-toasts-ui` (full/main). #38 stays open until post-merge verify. | `live-toasts.test.ts`, `e2e/live-toasts.spec.ts`, `.github/workflows/ci.yml` |
| Untrusted token metadata / CSP (P1) | Public UI never renders creator identity as HTML. URL scheme + media allowlists. Admission DENYs `javascript:` / `data:` / HTML names. Production CSP is middleware nonce + `strict-dynamic` (no script `'unsafe-inline'`). Live header + bundle-sentinel + browser XSS corpus. Wallet writes ignore metadata and indexer `tx`; wrong chain is a hard block. | `untrusted-metadata.test.ts`, `security-headers.test.ts`, `tx-guard.test.ts`, `secret-sentinel.test.ts`, `e2e/prod-security.spec.ts`, `docs/web-security.md` |
| Exact official-list screening (#61) | OFAC/Treasury HTTPS XML only (SDN + Consolidated). EVM 20-byte identity. Atomic refresh with 85% completeness floor. Version id includes source-generation metadata so same-address refresh persists new `retrievedAt`. `blocked` / `clear` / `unavailable`. No compliance claim. Lookup API is not the write gate. | `packages/sanctions/src/*.test.ts`, `apps/indexer/src/sanctions-api.test.ts`, `SANCTIONS.md`, `/docs/sanctions` |
| Trusted geo policy (P1 #63) | One server interface: ALLOW / DENY / UNKNOWN + reason. Production geo only from signed edge headers (`GEO_EDGE_SECRET`). Versioned comprehensive-jurisdiction file **revision 3**. Oblast `UA-14`/`UA-09` UNKNOWN (FAQ 1009); DENY only on precise covered-region claim. LOCAL fixture isolation. VPN/Tor best-effort. HTTP write enforcement is #62. Not SDN (#61). | `geo-policy.test.ts` (core + indexer), `docs/geo-policy.md` |
| Operator policy gate (P1, #62) | Shared allow/deny/unavailable on REACTOR-operated write/auth paths. Binds `#66` `indexerSanctionsStore().screen` and `#67` `evaluateRequestGeo`. Fail closed. Recovered-wallet proof + `GET /operator-policy/status`. Production HTTP matrix on real indexer + `next start`. No client-flag override. Does not claim onchain blocking. | `sanctions-policy.test.ts`, `wallet-proof.test.ts`, `operator-policy.test.ts`, `operator-policy-bff.test.ts`, `scripts/operator-policy-http.test.ts`, `/docs/operator-policy` |
| Restricted access UX (#65) | `/restricted` + banner + disabled operated write CTAs. Official #68 `GET /operator-policy/status` + challenge signing helper + write gates. No-proof status is wallet-missing unless geo deny. Claimed wallet ignored. Pending-proof stays Launch Instant; write gate authoritative. Public market/docs reads remain. No IP / screening leak. No VPN guidance. Honest “cannot censor chain reads” disclosure. Production matrix: wallet / geo / stale / allow, desktop + 390px. | `operator-policy-ux.test.ts`, `operator-policy-status.test.ts`, `e2e/restricted.spec.ts`, `e2e/restricted-prod.spec.ts`, `e2e/restricted-policy.ts`, `docs/restricted-access.md` |
| Repo publicization / public-fork Actions (P1 ops) | Visibility stays private until founder instruction. History rewrite of personal trailers **done** (noreply). AC1 = advertised refs only; residual dangling SHAs accepted (Support purge/GC not required). Workflow `contents: read` + `persist-credentials: false` on `.github/workflows/ci.yml`; no `pull_request_target`. Compatible with #69. Re-scan secrets before any visibility change. | `docs/publicization.md`, `scripts/ci-public-harden.test.ts`, `.github/workflows/ci.yml` |
| UI QA gate (P1) | Playwright `toHaveScreenshot` on **production `next build`** (1440 / 1280 laptop / 390 / 360 Android) + state matrix. axe + keyboard + dialog trap/restore + 200% zoom reflow + reduced-motion + live-toast semantics. **color-contrast is on** for production surfaces; only `canvas` / `[data-visual-mask]` / `[data-visual-dynamic]` are excluded (unmeasurable). Brand token AA is pinned in `e2e/contrast.ts`. Production muted text is `text-zinc-400`; leftover `text-zinc-500|600|700` fails `assertNoSubAaMutedText`. Shared fixture fails on unexpected `console.error`, hydration warnings, and `pageerror`. `?inject=` covers indexer/rpc/quote 429/413/5xx/stale/expired/noroute, pricing, upload, SSE no-dupe, empty, invalid token/ticker, wallet reject/revert. CI `web-qa` (`.github/workflows/ci.yml`, full/main) fails on unexplained diffs. Production ignores inject. PR #49 merged at `ad7b457`. **#36 closed** after [`34729758795`](https://github.com/solarcurvey/reactor/actions/runs/34729758795). | `playwright.qa.config.ts`, `e2e/qa-fixture.ts`, `e2e/console-gate.ts`, `e2e/contrast.ts`, `e2e/visual.spec.ts`, `e2e/states.spec.ts`, `e2e/a11y.spec.ts`, `e2e/failures.spec.ts`, `qa-inject.test.ts`, `.github/workflows/ci.yml` (`web-qa`) |
| Sanctions freshness / audit / runbook (P1 #64) | 7-day official-list SLA. Bad/partial refresh keeps last-known-good. Stale/missing fails protected writes (`UNAVAILABLE_DATASET_STALE`). Health names dataset + policy versions. Audit redacts keys/sigs/IP/bodies. Alerts on stale, repeated refresh fail, policy fail. No automated complaint override. Identity is #62 recovered EIP-191 (claimed wallets ignored). Fixture refresh LOCAL/test-only. Same-address refresh persists a new #61-style source-generation. Official #61 refresh binds when `sanctions.ts` is present. | `sanctions-ops.test.ts`, `sanctions-audit.test.ts`, indexer `sanctions-ops.test.ts`, `docs/sanctions-ops.md`, `docs/sanctions-runbook.md`, `docs/incident-response.md` |
| User routes | `UserRouteExecutor` + shared RoutePlanner; bonding nested USDC + graduated v4 | `UserRoute.t.sol` |
| Production UI E2E gate | `next build`/`next start` + EIP-1193 fixture **and** MetaMask/Rabby-style MV3 extension (no mainnet keys). Desktop + iPhone-class + narrow-Android. BUY/SELL/nested BUY+SELL (`UserRouteExecutor` target/calldata/result), bonding/graduated/launch/rewards/Dev Buy, full ticket lifecycle, lock/switch/disconnect, revert, allowance, quote TTL, dropped/replaced tx, double-submit, wrong-chain, reject. Ticket/launch phase lines use visible `text-zinc-400` (do not weaken `assertNoSubAaMutedText`). Rewards defers wallet chrome until mount. WalletButton hydrates the Connect tree first so a post-connect full navigation cannot React-418. Disconnect stays in the Account modal. Header `WalletButton` is the only connect/account control (`/wallet` is status-only). Shared `console.error` / `pageerror` fixture fails teardown (documented allowlist: Chromium HTTP 503 on `/api/launch-pricing` during Dev Buy authorize-down; Next.js RSC prefetch fallback on iPhone WebKit / Firefox; WebKit EventSource `/stream` access-control only; mock JSON echoes Origin so `/markets` is real CORS). `docs:check` rejects leftover conflict markers. Refs #35 / Refs #15 only. | `apps/web/e2e/release/{journeys,edge,extension}.spec.ts`, `e2e/harness/console-gate.ts`, `playwright.release.config.ts`, `.github/workflows/ci.yml` job `e2e-release-gate` |
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

Signer is `ReactorGuardian.launchSigner` (≠ Keeper ≠ Guardian Safe; Guardian may rotate). Domain is `TickerRegistry.domainSeparator`. Replay via `TickerRegistry.usedAuthorization[digest]`. **No per-quote serial nonce** — concurrent same-quote launches use unique `authId`. TTL ≤ 30 minutes. Creator must be `msg.sender`. EIP-712 binds the full immutable identity (ticker, name, metadata hash, quote, mode, virtualQuote0, curve, factory version). **No onchain ZEC/USD oracle** — the signature attests protocol curve constants for that quote’s decimals. ValuationService (offchain configured registry + multi-source consensus + optional Arc venue sanity) produces `virtualQuote0`; if unreliable that quote launch is disabled. PROD never uses a static mark.

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

Indexer `GET /top10` is the official snapshot (schema v11). Web `/api/reactor/top10` proxies it. `discoverTop10` Factory RPC is removed.

- Graduated only; skip CORE
- Supply is persisted `tokens.current_supply` (schema v9). After v9, empty `current_supply` on a graduated non-CORE name **pauses the epoch**. No mint-supply (`tokens.supply`) fallback. Writers remain token `Burned` / Transfer-to-zero via `(chain_id,tx,log_index,event_kind)` in the same `persistTickBatch` transaction as the cursor, plus bounded reconcile, including at head. Not TokenCreated `tokens.supply`, not a protocol-event sum, and not claimed ≡ between reconciles
- Official 10–15m VWAP/TWAP-like from indexed official trades
- External quote USD: configured provider registry + consensus (schema v10). ValuationService ancestry only. PROD never uses a static mark. No onchain oracle
- Indexed liquidity is `graduations.quote_lp` else `markets.real_quote`, valued in USDC. Never `lastGoodMark / 5`. Material-uncertainty liquidity arm is independent of last-good mark
- Depth 3, cycle set, **$250k** floor
- Fail-closed **only** for MATERIAL uncertainty (prior ranked, last-good ≥ floor, **indexed** liquidity ≥ floor/5, window volume). Thousands of dead low-value graduates with &lt;3 trades do **not** freeze the epoch
- Snapshot TTL 15 minutes (`TOP10_SNAPSHOT_TTL_SEC`), shared by API serve and Keeper `acceptTop10Snapshot`. Ingest `tick()` persist-on-fail writes a paused row so a stalled refresh cannot leave the last healthy payload

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
- Frontend / indexer / Top-10 API / pricing signer are **not** trusted for balances or USD. `/page/token` and `/markets` are display aggregation. Live tickets remain `POST /quote` (30s TTL, fail-closed). Canonical Multicall3 is probed, not assumed on Arc.
- Isolated pricing signer **fail-closes** when Postgres/SQLite cannot be opened. A missing store is `SIGNER_STORE_UNAVAILABLE` (503), not an unsigned-or-unchecked mint. Receipt consume + issuance bucket are mandatory.
- Public JSON POSTs are stream-capped at 16KiB default / 64KiB hard max so the indexer cannot buffer an unbounded body. Env cannot raise the cap past the hard max. This is an availability control, not an authenticity control.
- BUSL allows this PoolManager deploy only as **non-production**.
- Designated Keeper + pricing signer are operational keys. Compromise wastes a chunked pot or authorizes a non-$1 curve init — it cannot steal LP or rewrite fees.

## Limitations

- Official router is exact-in first. Exact-out exists at the hook but is less tested in the UI.
- UserRoute `sell` takes caller `minQuoteOut` on the official first-leg and `minFinalOut` on the USDC exit. Intermediate hop floors are caller-supplied (`RouteExec` rejects 0). Sandwich of the official pool reverts when those floors are set from a quote (`UserRoute.t.sol`). The quote API derives both floors from the same selected `PreviewedRoute` (`splitPreviewRoute.terminalOut` → `minQuoteOut`, final USDC → `minFinalOut`) — never from `tokenIn` (`quote-sell-floors.test.ts`).
- `POST /quote` tickets take hops, `amountOut`, hop kinds, hop `minOut`s, and the terminal official/bonding result from **one** selected candidate. `PreviewRoute` is `plannedHops + 1` (BUY appends the market leg; SELL prepends it). The indexer must not pair a max-`finalOut` preview with a differently scored path (`quote-integrity.test.ts`).
- `launchAndBuy` unsigned path still uses internal curve `minOut=1` then checks the user `minOut` after.
- No TWAP on buyback; Keeper sets slippage.
- Fair launch is CCA-inspired, not the Uniswap CCA factory (ADR-002).
- Instant is not Uniswap InstantLaunchStrategy (ADR-001).
- Local demo uses mock USDC-6, not Arc native gas USDC.
- Keeper daemon submits `submitEpoch` on local Anvil 5042002 when the API is confident (Anvil #0 key). Other chains refuse broadcast unless `KEEPER_PRIVATE_KEY` is set. Watchdog reads heartbeat **and** on-chain `epochFinalized`.
- Leadership lease TTL (~50s) is shorter than possible tick work. The leader renews `lease_until` and fences send on acquire-generation `ts`. A lost fence refuses broadcast (split-brain). Not an on-chain fence. Two independent Postgres workers: `test:pg-lease`.

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
pnpm size:guard
pnpm --filter indexer test
pnpm test:web-unit
pnpm docs:check
pnpm docs:links
# pnpm test:web-security  # ci.yml job web-production-security (full/main)
# GitHub: .github/workflows/ci.yml (three-tier; #17 extras are full-only jobs)
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
6. Pricing-signer compromise authorizing a non-$1 curve with a wrong `virtualQuote0` (operational; no onchain USD oracle). Store-down is fail-closed (no skip of consume / bucket).
7. Offchain Top-10 / 10–15m VWAP window bugs (fail-closed only when a **material** candidate is unvalued)
8. **Codex: protocolExempt reentrancy** — latch + `nonReentrant` + `WalletExemptForbidden`. Named malicious token callback in `ProtocolExemptReentrancy.t.sol`
9. Intermediate nested-hop floors: `previewSettleQuote` / `previewTop10Hops` / `previewExecuteHops` revert with per-hop outs (`RouteExec.PreviewHops`). Keeper stamps each hop via `stampHopMinOuts`. Last-leg reuse is rejected. Tests: `HopFloors.t.sol`.

## §43 Self-audit (this pass)

| Check | Result |
| --- | --- |
| Signed `virtualQuote0` initializes InstantCurve | Yes — Factory passes verified auth; **usdPegOne only** unsigned |
| USD-equivalent geometry USDC/ZEC/WBTC/native | `LaunchPricing.t.sol` |
| Protocol nested settle fee-exempt | `ProtocolV4Adapter` + `ProtocolSettlement.t.sol` |
| User hops still pay 3.5% | same. Nested official hops disclosed from the **scored winner** + terminal (`feeLegs[]`, two 3.5% legs compound 6.88%). Protocol edges are `exemptOfficialLegs[]`. Trade UI formats each charged leg in that hop’s quote decimals and never sums ZEC+ZCAT raw amounts. Issue #5 remains open. |
| UserRoute bonding + graduated USDC | `UserRoute.t.sol` |
| No `Guardian.setHook` | Removed; adapters hookless + official only |
| Top-10 10–15m VWAP, fail-closed unvalued | `marketdata.ts` / `top10.ts` |
| Keeper simulate→minOut→receipt, modes, no mainnet | `apps/indexer/src/keeper.ts` |
| Independent watchdog | `watchdog.ts` |
| CORE ticks / vest / burn / never Top-10 | `CoreLiquiditySim.t.sol` |
| QuoteAssetRegistry: no usdOracle / bounty fields | Cleaned |
| MarketOracle / KeeperReserve | Still deleted |
| No public mainnet | Chain 5042 hard-disabled |
