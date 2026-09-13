# TESTING

## Commands

```bash
cd contracts
export PATH="$PATH:$HOME/.foundry/bin"

forge test -vv
forge test --fuzz-runs 256
forge test --match-path test/invariant/RewardCampaign.t.sol -vv
# Do not treat test/unit/FeeInvariant.t.sol or test/invariant/Rewards.t.sol as stateful invariants.
# CI Attack suite: forge test <file> for each test/attack/*.t.sol (PATH, not --match-path glob)
forge test test/attack/CurveFreeze.t.sol -vv
forge test --match-path test/integration/* -vv
```

Indexer Top-10 / web ranker / keeper / valuation / indexer schema (no per-request RPC):

```bash
pnpm --filter indexer test
# includes packages/reactor/src/untrusted-metadata.test.ts (malicious metadata + CSP lock)
# keeper.lease.test.ts TTL / renew / steal cases inject lease-clock.fake.ts (not wall-clock setInterval)
# tick-atomic.test.ts: SQLite always; Postgres when DATABASE_URL or compose :54329 is up (REQUIRE_PG=1 to fail if missing)
# two Keeper workers on real Postgres (CI job postgres-ms-timestamps / test:pg-lease; docker compose postgres :54329)
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg-lease
npx --yes tsx apps/web/src/lib/top10.test.ts
npx --yes tsx apps/web/src/lib/marketdata.test.ts
npx --yes tsx apps/web/src/lib/live-toasts.test.ts
npx --yes tsx apps/web/src/lib/indexed.test.ts
pnpm test:page-budget         # same as page-budget.test.ts; required always-on CI job page-budget
# CI: .github/workflows/ci.yml job page-budget (required; every PR including drafts; ci-ok requires it).
# #73 should absorb this as a fast job — do not add a second push+pull_request file.
npx --yes tsx apps/web/src/lib/security-headers.test.ts
npx --yes tsx apps/web/src/lib/tx-guard.test.ts
npx --yes tsx apps/web/src/lib/secret-sentinel.test.ts
npx --yes tsx packages/reactor/src/untrusted-metadata.test.ts
npx --yes tsx scripts/safe-genesis-builder.test.ts  # Safe ≠ deployer, batch A/B, MultiSend (#17)
pnpm --filter @reactor/sanctions test   # #61 exact official-list parser/store/screen (pinned fixtures, no network)
# SANCTIONS_NETWORK=1 pnpm test:sanctions:network   # isolated live OFAC HTTPS; not unit CI
npx --yes tsx packages/reactor/src/sanctions-policy.test.ts
npx --yes tsx packages/reactor/src/wallet-proof.test.ts
npx --yes tsx apps/indexer/src/operator-policy.test.ts
npx --yes tsx apps/web/src/lib/operator-policy-bff.test.ts
pnpm test:operator-policy-http  # real indexer + production Next HTTP matrix (CI full/main job operator-policy-http)
pnpm docs:check                 # fees / supply / Dev Buy / ticker lock / factory / protocol version / deployments
pnpm docs:links                 # in-repo /docs slugs + relative files (CI docs-links job; no network)
pnpm test:web-unit              # top10 / marketdata / limited-json / fee-legs / constants-sync
pnpm test:ci-cost               # #69: no duplicate push+PR, concurrency, fail-safe paths
npx --yes tsx scripts/ci-public-harden.test.ts  # #72: permissions / persist-credentials / no pull_request_target
# CI: .github/workflows/ci.yml contents:read; actions/checkout persist-credentials:false.
pnpm --filter web test          # Playwright smoke + interactive + live-toasts (dev server; not visual/a11y/failures)
pnpm --filter web test:qa       # prod next build + screenshot matrix + axe + keyboard + ?inject= (CI ci.yml job web-qa)
pnpm test:live-toasts           # #38 gate: identity unit + Playwright dismiss / multi-log / reconnect / safe-area / reduced-motion
tsx apps/web/src/lib/qa-inject.test.ts
tsx apps/web/e2e/console-gate.test.ts
tsx apps/web/e2e/contrast.test.ts
# CI full/main: .github/workflows/ci.yml job live-toasts-ui. Fast PR: identity unit via test:lib. #38 stays open until post-merge verify.
pnpm test:web-security          # production next build/start: live headers, bundle sentinel, XSS corpus
# CI full/main: .github/workflows/ci.yml job web-production-security
# CI full/main: .github/workflows/ci.yml job web-qa. #36 closed after #49 post-merge `ad7b457` / 34729758795.
pnpm test:e2e:release           # production `next build`/`next start` + EIP-1193 wallet gate (issue #35)
# CI full/main: .github/workflows/ci.yml job e2e-release-gate. Do not add e2e-release.yml.
# Real Postgres (docker compose postgres on :54329, or local 5432)
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke
# CI full/main: .github/workflows/ci.yml job postgres-ms-timestamps (includes test:pg-lease)
```

`pnpm docs:check` (and `.github/workflows/ci.yml` job `constants-version-deployments`) **must fail** when generated constants, `docs/version.json`, Factory labels, or deployment tables have drifted from Solidity/config. Do not edit generated `docs/versioning.md` / `docs/deployments.md` / `docs/changelog.md` by hand — run `pnpm docs:gen`. `pnpm docs:links` (fast via `test:lib`; full-only job `docs-links`) **must fail** on unknown `/docs/<slug>` targets, missing relative files, or a `docs/*.md` page missing from `docs-nav.ts`. It does not fetch http(s) URLs.

Three-tier GitHub Actions (Refs #69): fast PR / full merge-candidate / main post-merge. #17 leftover extras (`docs:links`, Playwright smoke + interactive job `web`) are full-only jobs on the same `ci.yml`. Operator inventory: [`/docs/ci`](docs/ci.md). Do not add a feature-branch `push` + `pull_request` pair.

Public-fork hardening (Refs #72) is `scripts/ci-public-harden.test.ts` inside `pnpm test:lib`. It does not skip Foundry, `docs:check`, `test:web-security`, or `live-toasts-ui`. Personal-mailbox trailers were remapped 2026-09-12. AC1 is advertised refs only; residual dangling SHAs are accepted. Do not publicize without founder instruction — see `/docs/publicization`.

Authoritative current-architecture walk (Foundry, no live chain):

```bash
forge test --match-path test/integration/CurrentArchitecture.t.sol -vv
```

Live Anvil probe (needs deploy; **not** required for CI): `pnpm --filter indexer e2e`

Static analysis (optional, when slither is installed):

```bash
slither contracts/src --exclude-dependencies || true
```

## §39 Regression list

Every row is implemented in-repo. Re-run the matching file after any curve / fee / vault / routing change.

| # | Requirement | File / test |
| --- | --- | --- |
| 39.01 | Ready freeze: buy after ready reverts | `test/attack/CurveFreeze.t.sol` |
| 39.02 | Ready freeze: sell after ready reverts | same |
| 39.03 | Terminal buy → exact ready → graduate | same |
| 39.04 | One-before-terminal then fill | same |
| 39.05 | Exact terminal | same |
| 39.06 | Oversized terminal: clip + refund unexecuted + unearned fee | same + `Curve.t.sol` |
| 39.07 | Repeat graduate reverts | `CurveFreeze.t.sol` |
| 39.08 | Sell before ready succeeds; after ready reverts | same |
| 39.09 | Graduate revalidates reserves; no stranded inventory | same |
| 39.10 | SelfBurn `minTargetOut==0` reverts | `KeeperMinOut.t.sol` |
| 39.11 | Top-10 final `minTargetOut==0` reverts | same |
| 39.12 | CORE `minOut==0` reverts | same |
| 39.13 | Sandwich quote→exec reverts | same |
| 39.14 | No hardcoded maintenance `minOut=1` on vault execute | same (Keeper supplies) |
| 39.15 | `bindFactory` attacker frontrun | `FrontrunBind.t.sol` |
| 39.16 | Hook / vault / flywheel / registry / router binds | same |
| 39.17 | No Ownable / bootstrap residue | same |
| 39.18 | Privileged surface Guardian or Keeper only | `GuardianP0.t.sol`, `PRIVILEGE_MAP.md` |
| 39.19 | Signed launch auth: USDC requires EIP-712 | `LaunchAuthorization.t.sol`, `LaunchPricing.t.sol` |
| 94 | Ticker normalize / reserve / 24h lock / no squat | `TickerRegistry.t.sol` |
| 95 | LaunchAuthorization replay / ticker / factory / fair | `LaunchAuthorization.t.sol` |
| 96 | Factory version persist + deprecate new-only | `TickerRegistry.t.sol` |
| 97 | Permanent lock one-way | `TickerRegistry.t.sol` |
| 39.20 | Non-$1 without sig reverts | same |
| 39.21 | Expired / replay / wrong factory / quote / decimals / tampered / zero / chain | same |
| 39.22 | Old signer after rotation; Keeper rotate ≠ signer rotate | same |
| 39.23 | Unique digest replay / concurrent same-quote / quarantine (no serial nonce) | same |
| 39.43 | Signed `virtualQuote0` initializes the curve; USDC/ZEC/WBTC/native same USD geometry | `LaunchPricing.t.sol` |
| 39.44 | ProtocolV4Adapter nested settle creates zero new 2/1/0.5; user trade pays 3.5% | `ProtocolSettlement.t.sol` |
| 39.45 | UserRoute USDC path while bonding | `UserRoute.t.sol` |
| 39.46 | No `setHook`; hookless + official only | `GuardianP0.t.sol`, `RoutingDeltas.t.sol` |
| 39.47 | CORE ticks + vest + burn + Top-10 exclude | `CoreLiquiditySim.t.sol` |
| 39.24 | Rewards genesis `eligible==0` → SelfBurn | `Token.t.sol`, `Curve.t.sol` |
| 39.25 | Hop real in/out deltas | `RoutingDeltas.t.sol` |
| 39.26 | Lying adapter fails | same |
| 39.27 | Arbitrary v4 hook denied | same |
| 39.28 | Max 3 hops | same |
| 39.29 | No cycles | same |
| 39.30 | Flywheel / SelfBurn / CORE chunk + cooldown | `BlastRadius.t.sol`, vaults |
| 39.31 | CORE `burn()` only (no dead-address) | `BuybackVault._burn`, `Top10E2E.t.sol` |
| 28.xx | CORE genesis 35 cases | `test/unit/CoreGenesis.t.sol` |
| 29.xx | CORE stateful invariants | `test/invariant/CoreInvariant.t.sol` |
| 39.32 | UserRoute `minQuoteOut` + `minFinalOut` + deadline; sandwich reverts; not a vault | `UserRoute.t.sol` |
| 39.32b | Quote API SELL `minQuoteOut` from `splitPreviewRoute` terminal (6/8/18, bonding/graduated/nested); calldata matches; preview fail → no ticket | `quote-sell-floors.test.ts` |
| 39.33 | Top-10 structural: no CORE, no dupes, ≤10, weights 100% | `Top10Security.t.sol`, `Top10Api.t.sol` |
| 39.34 | Fee 3.5% → 2/1/0.5 | `FeeInvariant.t.sol` |
| 39.35 | No transfer tax | `Token.t.sol` |
| 39.36 | Reward solvency / leftover | `RewardSolvency.t.sol` |
| 39.37 | Liquidity lock | `LockAndBuyback.t.sol` |
| 39.38 | Fair 0% during sale; finalize once | `Launches.t.sol` |
| 39.39 | Cross-quote flush | `CrossQuoteFlush.t.sol` |
| 39.40 | CREATE2 hook bits | unit hook |
| 39.41 | FoT quote / reentrancy / sandwich docs | `Security.t.sol`, `Attacks.t.sol` |
| 39.42 | Guardian P0 routing/vault/Keeper (40 cases) | `GuardianP0.t.sol` |

## §40 Stateful invariants

| Suite | Command | Bound |
| --- | --- | --- |
| Reward campaign (magnified DPS, leftover, debt) | `forge test --match-path test/invariant/RewardCampaign.t.sol` | default 64 runs / 2048 calls; `outstanding <= backing` **no slack** |
| Reward solvency (legacy vs magnified) | `test/invariant/RewardSolvency.t.sol` | unit + invariant |
| Fee fuzz / flush fuzz | `test/fuzz/FeeFuzz.t.sol`, `FlushFuzz.t.sol` | dust / overflow |

**Do not** treat `FeeInvariant.t.sol` or `test/invariant/Rewards.t.sol` as the stateful campaign. Campaign asserts `outstanding <= backing` with no slack. See `HARDENING_REPORT.md`.

Not claimed as a proof: routing graph, nested USD marks, or Keeper liveness.

## §41 E2E

```bash
# Local chain must be running + deployed
pnpm --filter indexer demo   # viem + Anvil; writes deployments/e2e-evidence.json
```

Optional Foundry sketch: `contracts/script/DemoE2E.s.sol`.

UI capture (after `pnpm --filter web dev`):

```bash
CAPTURE=1 CAPTURE_URL=http://127.0.0.1:43147 pnpm --filter web test
```

Writes `review/*-1440.png` and `review/*-390.png` for home, compact Instant, fair, trade, rewards, THE REACTOR, CORE, quote ecosystems, wallet. **No creator FDV slider.**

CI visual gate (committed `toHaveScreenshot` baselines, not `review/`):

```bash
CI=1 pnpm --filter web test:qa
pnpm --filter web test:update-screenshots   # Linux Chromium only — same as Actions; against next build
```

`playwright.qa.config.ts` builds with `e2e/harness/start-web.mjs` (shared #35 path), `qa-mock.mjs`, and `qa-rpc.mjs` (JSON-RPC stub on the compiled RPC URL — not Anvil). Viewports include 1280 laptop and 360 Android. `?inject=` covers quote 429/413/5xx/stale/expired/noroute, pricing, upload, SSE, empty, invalid token/ticker, wallet reject/revert. Axe `color-contrast` is on (only canvas / visual-mask / visual-dynamic excluded); muted text is `text-zinc-400` and leftover `text-zinc-500|600|700` fails `assertNoSubAaMutedText`. The shared console/pageerror fixture fails the run on unexpected `console.error`, hydration warnings, and uncaught page exceptions (narrow inject allowlists only). Production builds omit the flags and ignore inject. See `/docs/qa`. Issue **#36 closed** after #49 post-merge `ad7b457` / [`34729758795`](https://github.com/solarcurvey/reactor/actions/runs/34729758795).

### Production-build browser + wallet gate (issue #35)

Release gate against **`next build` + `next start`**, not `next dev`. Chromium / Firefox / WebKit. Deterministic EIP-1193 fixture (Anvil #0 **address only** — no private key, no mainnet keys). Mock JSON-RPC `:18545` + indexer `:18448` so CI does not need Anvil, a Factory deploy, or the isolated signer. After #50 the mock serves the indexed read path (`GET /quote-assets`, `GET /markets/:token`, `GET /page/token/:token`) so Chromium does not log those as 404 `console.error`. After #68 the same mock serves public `GET /operator-policy/challenge` and `GET /operator-policy/status` so Launch / Quote / upload can attach `x-reactor-wallet-proof` (the EIP-1193 fixture auto-signs `personal_sign`; `rejectTx` is Confirm-buy / `eth_sendTransaction` only; the mock does not verify the signature). The MV3 extension prompt must Confirm the challenge `personal_sign` after Quote, then Confirm the trade.

```bash
pnpm test:e2e:release
# apps/web: pnpm test:release
# CI full/main: .github/workflows/ci.yml job e2e-release-gate
# Do not recreate .github/workflows/e2e-release.yml (folded in #73).
```

Journeys: graduated BUY/SELL (`ReactorRouter.swap`), bonding BUY/SELL (`InstantCurve`), nested USDC BUY+SELL (`UserRouteExecutor.buy` / `.sell` calldata + result hash), ready `graduate`, Instant launch (`Factory`), rewards claim, wrong-chain switch, user-rejected connect/tx (EIP-1193 `4001`). Asserts frozen 3.5% / 2/1/0.5 and **no creator FDV knobs**. Desktop plus iPhone-class and narrow-Android production projects.

Release-candidate extras (Chromium):

- MetaMask/Rabby-style **unpacked MV3 extension** (`e2e/extension`, project `chromium-extension`) — connect/confirm/reject/lock/account switch through a real prompt page (`notification.html`). Provider is injected in the MAIN world at `document_start`. CI wraps the suite in `xvfb-run` so Chromium new-headless can load MV3. Anvil #0/#1 **addresses only**.
- Edge file `e2e/release/edge.spec.ts`: disconnect/reconnect, account/chain change mid-flow, locked wallet, insufficient funds/allowance, revert, dropped tx, quote TTL, quote expiry while the wallet prompt is held, double-submit lock, full `idle → quoting → approval/signature → submitted/pending → confirmed`, Dev Buy happy + authorize-down failure.
- One Playwright worker (`fullyParallel: false`). The mock JSON-RPC/indexer is shared; receipt / allowance / launch-auth controls must not race.
- Shared console/pageerror gate (`e2e/harness/console-gate.ts`) on every release-gate page (EIP-1193 `wallet.ts` and MV3 `extension.ts` fixtures). Records `page.on('console')` error-level messages and `page.on('pageerror')`. Documented allowlist only: Chromium HTTP 503 on `/api/launch-pricing` (Dev Buy authorize-down, fail-closed); Next.js RSC prefetch fallback on iPhone WebKit / Firefox home (`?_rsc=` access-control `pageerror` on WebKit; full navigation still works); WebKit EventSource to mock `/stream` (exact `/127.0.0.1:18448/stream due to access control checks`, optional `Fetch API` prefix — other `:18448` paths stay unexpected). Header `WalletButton` is the only connect/Account control; `/wallet` is a status card. Teardown fails with the captured diagnostics. Trace / screenshot / network stay retain-on-failure.

Issue **#35 stays open** until merge + post-merge verify. Live Anvil demo remains `pnpm --filter indexer demo`.

Keeper / watchdog (do not treat as onchain):

```bash
pnpm --filter indexer keeper
pnpm --filter indexer watchdog
```

## Required suites (legacy map)

| Area | File |
| --- | --- |
| Guardian / Keeper / routing P0 §42 | `test/unit/GuardianP0.t.sol` |
| Top-10 API §43 | `test/unit/Top10Api.t.sol` |
| Top-10 / Keeper security | `test/attack/Top10Security.t.sol` |
| Top-10 + CORE E2E burns | `test/integration/Top10E2E.t.sol` |
| Curve freeze | `test/attack/CurveFreeze.t.sol` |
| Keeper minOut | `test/attack/KeeperMinOut.t.sol` |
| Frontrun binds | `test/attack/FrontrunBind.t.sol` |
| Launch pricing | `test/attack/LaunchPricing.t.sol` |
| Routing deltas / hooks | `test/attack/RoutingDeltas.t.sol` |
| Nested hop floors | `test/attack/HopFloors.t.sol` |

## Final-pass regressions (user list)

| # | Requirement | Proof |
| --- | --- | --- |
| 1 | Vault execute returns burned/core/target/usdc | `KeeperReturns.t.sol` |
| 2 | Keeper minOut > dust | `keeper.minout.test.ts`, `KeeperMinOut.t.sol` |
| 3 | Low sim blocks tx | `conservativeMinOut` throws ≤1 |
| 4 | Dynamic quote buckets | `keeper.ts` `discoverQuotes` |
| 5 | Nested settle + nested Top-10 fee-exempt | `ProtocolSettlement.t.sol` |
| 6 | Historical swap timestamps | `indexer.persist.test.ts` |
| 7 | Indexer restart pool maps | same |
| 7b | Event writes + cursor atomic (including token burn journal); canonical `(chain_id, tx, log_index, event_kind)` (SQLite + Postgres) | `tick-atomic.test.ts`, `pg-smoke.ts` |
| 8 | Inactive low-value does not freeze | `Top10Api.t.sol` thousands inactive |
| 9 | Material candidate freezes | same |
| 10 | External spot does not control mark | VWAP window + `fuseExternalUsd6` |
| 11 | Nested ValuationService + cycle reject | `valuation.test.ts` |
| 38 | Configured price registry + consensus persist + fail-closed launch/Top-10 | `pricing.test.ts`, `price-marks.test.ts` |
| 12 | EURC not $1 | `LaunchPricing.t.sol` |
| 13 | USDC still requires LaunchAuthorization | `LaunchAuthorization.t.sol` §95 |
| 14 | Concurrent auths + no replay | `LaunchPricing.t.sol` |
| 15 | Bonding nested USDC buy/sell | `UserRoute.t.sol` |
| 16 | Keeper LOCAL + ARC_TESTNET | `keeper.ts` modes; 5042 disabled |
| 17 | No double-exec on ambiguous RPC | `submitOnce` |
| 18 | Protocol-exempt reentrancy blocked | `ProtocolExemptReentrancy.t.sol` |
| 19 | Safe genesis payload | `SafeGenesis.t.sol`, `VerifyGenesis.s.sol` |
| 20 | Deployer no post-genesis privilege | same |
| 21 | Nested hop floors from per-hop sim, not last-leg/dust | `HopFloors.t.sol`, `stampHopMinOuts`, `applyMinOuts` |
| 22 | Public buyPrefunded drain deleted; router-only pull | `BuyPrefundedDrain.t.sol` |
| 23 | Keeper executes frozen onchain epoch, not latest API | `frozenEpochTargets` in `keeper.minout.test.ts` |
| 24 | lastGoodFdvQuote accepts 3 historical samples | `marketdata.test.ts` |
| 25 | CAT/ZCAT nested e2e (not CAT/USDC) | `CurrentArchitecture.t.sol` |
| 94 | Ticker normalize + 24h lock + no squat | `TickerRegistry.t.sol` |
| 95 | LaunchAuthorization every launch, unique authId | `LaunchAuthorization.t.sol` |
| 96 | Factory version persist; deprecate new-only | `TickerRegistry.t.sol` |
| 97 | Permanent lock one-way, not an oracle | `TickerRegistry.t.sol` |
| 80 | P0 admission: signer bypass fails; CHALLENGE ≠ ALLOW; durable throttle | `admission.test.ts` |
| 80 | P0 EIP-712 full identity + frozen metadata + hardened lock | `LaunchAuthorization.t.sol`, `TickerRegistry.t.sol` |
| 80 | P0 quote exact RouteGraph edges; never minOut 0/1 | `routes.test.ts`, `quote-service.ts` |
| 80 | P0 Factory EIP-170 sizes + Arc attempt | `scripts/size-guard.ts`, `deployments/arc-factory-attempt.json` |
| 26 | Turnstile widget + ELEVATED/ATTACK ALLOW after challenge | `admission-unit.test.ts`, `admission.test.ts` |
| 27 | launchConfigHash + atomic receipt consume | `admission.test.ts` |
| 36 | Pricing signer fail-closed without durable store (no skip consume / bucket) | `pricing-signer-store.test.ts` |
| 28 | Fair curveConfig binds sale params | `FairCurveConfig.t.sol` |
| 29 | permanentlyLockTicker vs other token 24h lock | `TickerRegistry.t.sol` |
| 30 | 24h NUMERIC / latest-by-ts / ValuationService USD | `ingest.ts`, `valuation.test.ts` |
| 30b | `fdv_usd6` tracks remaining `totalSupply()` (holder burn, protocol-only would stay stale, identity + reconcile, CORE). Schema v9 from a real post-#27 (v8) DB | `ingest.valuation.test.ts`, `schema.test.ts` |
| 30c | Token burn journal + cursor are one transaction; crash on `indexer_state` cannot skip `Burned`/`Transfer` rows on restart (SQLite + Postgres) | `tick-atomic.test.ts` `runBurnCursorAtomicSuite`, `pg-smoke.ts` |
| 31 | UserRouteQuoter one eth_call; never minOut 0/1 | `quote-service.ts`, `UserRouteQuoter.sol` |
| 32 | Nested quote without intermediate wallet balances | `UserRoute.t.sol` `test_nested_preview_without_intermediate_wallet_balances`, `quote-overrides.test.ts` |
| 33 | Production hard gates (Turnstile + no Anvil/inline signer) | `prod-gates.test.ts` |
| 34 | Safe Builder JSON from local artifacts; deployer ≠ Safe. Required in `pnpm test:lib` | `scripts/safe-genesis-builder.test.ts` |
| 35 | sharp required (not optional) | `sharp-check.test.ts` |
| 36 | Postgres millisecond columns are BIGINT; Date.now() persists; v5 migrates | `pg-ms-timestamps.test.ts` (`pnpm --filter indexer test:pg`) |
| 37 | R2/S3 object key equals public `/m/<id>.webp`; mock GET returns the object; PROD upload failure returns no StoredMedia | `media-r2.test.ts` |
| 38 | Indexer event writes + cursor atomic; log identity `(chain_id, tx, log_index, event_kind)` (schema v8 journal); token burns in the same tick transaction | `tick-atomic.test.ts` (SQLite + Postgres), `pg-smoke.ts` |
| 39 | Selected route + atomic preview/minOuts/terminal from the same candidate; PreviewRoute is hops+1 (BUY append / SELL prepend) | `quote-integrity.test.ts`, `quote-select.ts`, `UserRoute.t.sol` `test_nested_previewSell_hops_plus_terminal` |
| 40 | Keeper lease renew + fence: long tick cannot overlap; stale fence cannot send. TTL cases use an injected clock (`lease-clock.fake.ts`) so CI load cannot miss a `setInterval` renew | `keeper.lease.test.ts` |
| 41 | Two Postgres workers: one winner, renew vs overlap, expiry/crash takeover, stale fence cannot send. AC1 is real `Date.now()` BIGINT; renew/expiry ACs inject the same clock | `keeper.lease.pg.test.ts` (`test:pg-lease`, CI `postgres-ms-timestamps` on full/main) |
| 42 | Markets keyset cursor matches `sort` (`new`/`vol`/`price`); insert-ahead no dupes | `markets-query.test.ts` |
| 43 | Candle gap-fill bounded; exclusive aligned `before` | `packages/reactor/src/prices.test.ts` |
| 44 | Public JSON POSTs reject oversized / chunked bodies (413); env cannot raise past 64KiB hard max | `read-json-body.test.ts`, `limited-json.test.ts` |
| 45 | Routed SELL `minQuoteOut` is first-leg quoteOut from `splitPreviewRoute` | `quote-sell-floors.test.ts`, `sell-floors.ts` |
| 46 | Nested official fee legs from scored winner + compound 688 bps; maintenance `exemptOfficialLegs[]` | `quote.test.ts`, `quote-api.test.ts`, `quote-integrity.test.ts` |
| 47 | Trade ticket does not sum nested fee amounts across quote tokens/decimals (ZEC-8 vs ZCAT-18) | `apps/web/src/lib/fee-legs.test.ts` |
| 48 | `external_price_marks.kind` is schema v10 after #23 v9 `current_supply`; real v8→v10 and v9→v10 upgrades | `schema.test.ts`, `pg-ms-timestamps.test.ts` |
| 49 | Production Next + EIP-1193 wallet E2E release gate (desktop + iPhone/Android, BUY/SELL/nested BUY+SELL `UserRouteExecutor` calldata, bonding/graduated/launch/rewards, wrong-chain, reject). Unexpected `console.error` / `pageerror` fail teardown (`e2e/harness/console-gate.ts`) | `apps/web/e2e/release/journeys.spec.ts`, `playwright.release.config.ts`, `e2e/harness/console-gate.ts`, `pnpm test:e2e:release` |
| 49b | Extension wallet + edge (lock/switch/disconnect, revert, allowance, quote TTL, drop, double-submit, Dev Buy); same console/pageerror gate on the extension page fixture; `docs:check` rejects leftover conflict markers | `e2e/release/edge.spec.ts`, `e2e/release/extension.spec.ts`, `e2e/extension/`, `e2e/harness/console-gate.ts`, `scripts/sync-docs.ts` |
| 49 | Top-10 ranks from indexer ValuationService snapshot (schema v11); no `discoverTop10` Factory RPC | `top10-rank.test.ts`, `packages/reactor/src/top10.test.ts`, `apps/web/src/lib/marketdata.test.ts` |
| 50 | Top-10 snapshot TTL: healthy → age past 15m → refresh fails → API pauses and Keeper refuses; indexed `quote_lp` liquidity arm; no mint-supply fallback after v9 | `top10-rank.test.ts`, `packages/reactor/src/top10.test.ts` |
| 51 | Untrusted token metadata (no raw HTML, URL scheme allowlist, media policy) + production CSP (nonce `script-src`, live headers, bundle sentinel, browser XSS corpus, tx-guard / chain mismatch) | `untrusted-metadata.test.ts`, `security-headers.test.ts`, `tx-guard.test.ts`, `secret-sentinel.test.ts`, `e2e/prod-security.spec.ts`, `admission-unit.test.ts` |
| 52 | Exact official-list screening (#61): EVM canonicalization, duplicates, malformed rows, non-EVM families; default SDN+Consolidated refresh; 85% completeness floor; same-address refresh persists new retrievedAt; atomic last-known-good; `blocked`/`clear`/`unavailable` + version | `packages/sanctions/src/normalize.test.ts`, `parse.test.ts`, `store.test.ts`, `screen.test.ts`, `refresh.test.ts`, `http.test.ts`, `apps/indexer/src/sanctions-api.test.ts` |
| 53 | Multicall3 probed then verified; missing/failed multicall falls back to parallel `readContract` | `packages/reactor/src/rpc-batch.test.ts` |
| 54 | `GET /markets/:token` + `GET /page/token/:token` aggregate market/candles/swaps; invalid token rejected | `page-reads.test.ts`, `markets-query.test.ts` |
| 55 | Search/query path + quote-asset / market row mapping | `apps/web/src/lib/indexed.test.ts` |
| 56 | Page request/RPC budgets on 4k seeded markets; abort obsolete loads; SSE patches without invalidate; no refetch-on-focus. Required always-on CI job `page-budget` (`ci-ok` requires success) | `apps/web/src/lib/page-budget.test.ts`, `.github/workflows/ci.yml` |
| 57 | Full GitHub CI on the #69 three-tier `ci.yml`: Solidity / size guard / Attack / CREATE2, backend + web unit + Safe genesis via `test:lib`, `docs:check` + `docs:links`, Playwright smoke + interactive (`web`), Postgres | `.github/workflows/ci.yml`, `docs/ci.md`, `scripts/docs-links.ts`, `scripts/safe-genesis-builder.test.ts` |
| 58 | Visual / a11y / failure-injection gate; CI fails on unexplained screenshot, serious axe diffs, color-contrast, leftover `text-zinc-500|600|700`, or unexpected console/pageerror | `e2e/visual.spec.ts`, `e2e/states.spec.ts`, `e2e/a11y.spec.ts`, `e2e/failures.spec.ts`, `qa-inject.test.ts`, `e2e/contrast.test.ts`, `e2e/console-gate.test.ts` |
| 59 | Trusted geo policy (#63): ALLOW/DENY/UNKNOWN + reason codes; production HMAC edge only; LOCAL fixture cannot load production deny ISOs; region fail-closed; `UA-14`/`UA-09` oblast UNKNOWN (FAQ 1009); precise `UA-DPR`/`UA-LPR` still DENY; SY not blanket-denied; VPN best-effort; no UI country list | `packages/reactor/src/geo-policy.test.ts`, `apps/indexer/src/geo-policy.test.ts` |
| 60 | Operator policy gate (#62): recovered wallet proof; sign-as-BLOCKED + claim CLEAR still denies; blocked geo / allow / stale dataset / missing proof / public GET reads + `GET /operator-policy/status` (#65 contract) / denial before signer/upload/tx payload. Official `#66` `indexerSanctionsStore().screen` + `#67` `evaluateRequestGeo` bind against `apps/indexer/src` (LOCAL FX DENY; HMAC `UA-14` oblast UNKNOWN; HMAC `UA-DPR` DENY). Production HTTP: real indexer + `next start` matrix (`pnpm test:operator-policy-http`, full-only job `operator-policy-http`). | `packages/reactor/src/sanctions-policy.test.ts`, `packages/reactor/src/wallet-proof.test.ts`, `apps/indexer/src/operator-policy.test.ts`, `apps/web/src/lib/operator-policy-bff.test.ts`, `scripts/operator-policy-http.test.ts` |
| 61 | Sanctions freshness SLA, last-known-good refresh, stale protected writes, health versions, audit redaction, failure-injection alerts; recovered-identity-only gate (merged #62 `operator-policy.ts`); LOCAL/test-only fixture fallback (bound `#61` store loads pinned OFAC XML, no live treasury.gov unless `SANCTIONS_NETWORK=1`); same-address refresh generation is restart-safe (`retrievedAt` from t1 after `loadFromDisk`) (#64) | `packages/reactor/src/sanctions-ops.test.ts`, `packages/reactor/src/sanctions-audit.test.ts`, `apps/indexer/src/sanctions-ops.test.ts`, `scripts/operator-policy-http.test.ts` |

## Arc smoke

`test/integration/ArcSmoke.t.sol` runs against the local Arc-compatible chain id and 6-decimal quote. A live RPC smoke (`--rpc-url $ARC_TESTNET_RPC`) is opt-in and must not be required for CI (see `/docs/ci`).
