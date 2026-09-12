# BUILD REPORT — Issue #16 Arc Public Testnet rehearsal

**Status:** Rebased onto `origin/main` `789eb5c` (#46 observability after #75 / #44 / #70 / #79 / #68 / #67 / #66 / #49 / #42 / #50 / #58 / #73). Protocol **0.3.4**. Factory **V1** unchanged. **#16 stays open.** Production-shaped `pnpm arc:wallet-harness` matches the Next `POST /quote` body and can Fair-authorize; live hashes go in `deployments/arc-testnet-journey.json` — do not invent them.
**Not audited. Not mainnet.**
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

| Item | Value |
| --- | --- |
| Protocol release | **0.3.4** (`docs/version.json`) — **unchanged this PR** |
| Factory | **V1** — **unchanged** |
| Intent | Full Arc Public Testnet deploy + Instant/Fair smoke (`Addresses #16`). |
| Deployer | `0xbeD4a2d496d280387FE65922fFbdf8C0f724bC6E` (`cast wallet new`, PK never committed; funded ~10 native USDC in [`0x788ce4a4…`](https://testnet.arcscan.app/tx/0x788ce4a45faacc534568a54e252255c25796eaf7d9137cb63f0d4eaf2457f2a8)) |
| Chain 5042002 | **Verified** live `eth_chainId` `0x4cef52` on `https://rpc.testnet.arc.network` |
| Factory | `0xB48D1B397834eBcccb8961041d827487097e0535` — [create tx](https://testnet.arcscan.app/tx/0xa7297d2104b926b9372d93d16598fd5e8c4171955b0e5d3b6ce6ce0468752c67) |
| Instant RHRSI | `0x62A7aDF0deb2c1918603e9834dD9ACe07CDA2f87` launch [`0xde5fb884…`](https://testnet.arcscan.app/tx/0xde5fb884a0495f15715963a710d3e1efd3f93237c22978ee351e15d726c77f6f) buy [`0xf50b7715…`](https://testnet.arcscan.app/tx/0xf50b7715ed981d379c9c37cf6badb227e047e15b2e932cd194088a8fa73886b3) sell [`0x71d6f3ec…`](https://testnet.arcscan.app/tx/0x71d6f3ecbfd4c3a7de02d2fb5f477d6c22a40bec12115ea951c99731565e25cd) |
| Fair RHRFA | `0x077322bE71C871F7134a9bb97e8f85A3991497c6` create [`0xb1a993e9…`](https://testnet.arcscan.app/tx/0xb1a993e9ce3c4261e1b2c6ee5b6cc92ca2fced4c9029b6960eabcbb979f0f46f) bid [`0xf2d8b9a3…`](https://testnet.arcscan.app/tx/0xf2d8b9a3f2407f037196506d4081c33f8787bcc62d1cff541f9f0c20bef362cb) finalize [`0xe839d3d2…`](https://testnet.arcscan.app/tx/0xe839d3d2230bb20448117149e61fed7c92ebe4307fcebeb886b8e65ca49d24c5) claim [`0x78f3f4ad…`](https://testnet.arcscan.app/tx/0x78f3f4adefe400cb452b022d15f2c0fcf99e44ca16abae29c553d83bb1e42ffb) |
| Quote | Mock USDC-6 `0x44CBe037ABFA8696E4466cA9D278Dbbe44B932dC` (labeled). Canonical `0x3600…0000` is not the Instant/Fair quote. |
| PoolManager | Official v4-core BUSL `0xC320E526477A9A9c8919A0A8200eAB38fE55033f` — rehearsal deploy, not a Circle-provided manager |
| Addresses | `deployments/arc-testnet.json` → `docs/deployments.md` |
| Workflows | Inherited merged **#46** / **#75** / **#44** / **#70** / **#79** / **#68** / **#67** / **#66** / **#49** / **#42** / **#50** / **#73** `.github/workflows/ci.yml` (three-tier + page-budget + `web-qa` + `e2e-release-gate` + `obs-ui` + `docs:links` + sanctions/geo/operator-policy/restricted-access fixtures). Prefer main for CI. Do not rewrite decide-tier. Actions billing empty-step failures are not AC failures. |
| Mainnet | **Blocked** |

Keep **#16 open** until Instant + Fair explorer AC are human-confirmed. Guardian-signed Factory smoke (`pnpm arc:smoke`) is recorded. The Next-shaped path is `POST /launch/authorize` → `launchStandard` / `createFairLaunch` → `POST /quote` → `UserRouteExecutor` (`pnpm arc:wallet-harness`). Full PROD still needs Turnstile + isolated signer ≠ deployer.

---

# Prior — GitBook-quality REACTOR handbook (merged #48, Refs #14)

**Status:** Squash-merged **#48** (`922f909`) on `origin/main`. The four #14 AC surfaces (body search, `docs:links`, docs-copy + visual baselines, badge matrix) landed with handbook chrome muted copy `text-zinc-400` (AA floor) — do not restore `text-zinc-500` on `/docs`. Issue **#14** close is a founder decision. **#54 is not a prerequisite.**
**Not audited. Not mainnet.**
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

---

# Prior — Industrial Forge brand implementation (merged #80, Refs #55)

**Status:** Implementation PR for issue **#55**. Founder (Davis) locked **Direction C — Industrial Forge**. This pass applies C to production surfaces and assets. Rebased onto `origin/main` `ff444cb` after squash-merged **#81** / #69 (docs-only path filter), **#46** / #39 (production observability), **#75** / #65 (restricted-access UX), **#44** / #35 (wallet E2E), **#70** / #64 (sanctions freshness), **#79** / #17 CI-evidence docs, **#68** / #62, **#67** / #63, **#66** / #61. **Do not close #55** until independent audit. Issue **#36 is closed** (`ad7b457`, post-merge `34729758795`); `web-qa` remains required and covers the approved-C state — do not weaken that gate. #81 `ci-decide` / `ci-ok` (docs-only cheap path; force-full still executes every required job), #39 observability (`obs-ui`, error boundaries, release SHA, vendor-proof) and #65 `/restricted` UX (denied-policy a11y/reflow, four-state matrix, hydration fixes), #35 `e2e-release-gate` and #64 sanctions-ops docs/runbook plus #66/#67/#68/#79 policy/CI-evidence content are preserved. Brand chrome is additive on those surfaces: `/restricted` kicker is `rx-kicker` (heat, no cyan), links and deny banners use 0–4px radius; amber remains the semantic warning, not a Direction B accent. #46 error boundaries keep `obs-ui` / release SHA / `traceId` and use heat kickers (no leftover cyan/pills). `SupportRef` and error mono use `text-zinc-400` (not zinc-500). Copy, testids, and policy behavior are unchanged.
**Not audited. Not mainnet.**
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.4** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Implement founder-locked Industrial Forge across tokens, logo, chrome, favicon/OG/app icons, voice, a11y, and docs. |
| Docs | `/docs/brand`, glossary/FAQ/policy/index/qa, `UX_REFERENCE.md`, `PROJECT.md`, `CONTRIBUTING.md` |
| Production chrome | `logo.tsx`, primitives, Discover / Launch / terminal / THE REACTOR / CORE / docs |
| Assets | `/favicon.svg`, `/favicon.ico`, Apple touch, 192/512, OG 1200×630, wordmarks |
| Close #55 | **No** — keep open for independent audit |
| #36 | **Closed** after `ad7b457` + post-merge `34729758795`. Approved-C + #44 chrome baselines are on this PR; `web-qa` stays required |
| Voice | One AI rule: `BRAND_AI_DISAMBIGUATION` in first-use metadata only; chrome/OG stay AI-free. Description is mode-correct: Rewards pay holders; Standard burns — not “every launch pays holders.” |
| Rebase | Onto `ff444cb` after **#81**. Same PR **#80** / same branch. Keep #81 `scripts/ci-decide.sh` / `scripts/ci-ok.sh` (docs-only/trivial ready PRs stay cheap; `ci-full` / dispatch / `main` still force every required job including `web-qa` + `obs-ui`), #39 `obs-ui` / error boundaries / release SHA / vendor-proof, #65 `/restricted` routes, amber banner, `text-zinc-400` muted floor, denied-policy a11y/reflow, production four-state matrix, and hydration fixes; plus #35 `e2e-release-gate`, #70 freshness/runbook, #79 CI-evidence docs, and #66/#67/#68 policy layers. Overlapping `web-qa` goldens recaptured as approved-C Industrial Forge **plus** #44 visible phase / stacked Quote-Confirm / wallet chrome (CI Chromium actuals from [`34737657863`](https://github.com/solarcurvey/reactor/actions/runs/34737657863)). Do not reuse [`34738076304`](https://github.com/solarcurvey/reactor/actions/runs/34738076304) (`25deda3` on `b190e86`) or pre-#81 [`34741435433`](https://github.com/solarcurvey/reactor/actions/runs/34741435433) (`7e62e69` on `789eb5c`) as merge proof for this tree. Brand chrome on `/restricted` is heat kicker + 4px radius (no cyan / no pill links). Do not weaken the gate. #55 stays open. |

## Founder decision

**Locked:** Direction C — Industrial Forge. Stands out more than A/B. Do not reopen A/B/C unless a concrete accessibility/technical blocker requires a narrow adjustment.

---

# Prior — CI docs-only path filter (merged #81, Refs #69 residual)

**Status:** Squash-merged **#81** (`ff444cb`) on `origin/main`. Addresses founder re-audit gap (2). **Do not close #69.** Frozen economics. No mainnet.
**Not audited. Not mainnet.**
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

Gap (1) source (`obs-ui`) is now on `main` via **#46**. #69 still needs **one green protected-main full run** after this cost fix (and after #46) that executes `obs-ui` rather than skip-as-pass.

## That HEAD (#69 gap 2)

| Item | Value |
| --- | --- |
| Protocol release | **0.3.4** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Ordinary docs-only / trivial non-draft PRs must not launch unrelated Solidity / Postgres / browser / `obs-ui` matrices. Force-full (`ci-full` / `workflow_dispatch` full / `push` to `main`) still runs every required job. `ci-ok` still rejects skipped required jobs on that full path. |
| Mechanism | `scripts/ci-decide.sh` classifies paths first, then sets `full` / `force_full`. Heavy jobs stay `if: needs.decide.outputs.full == 'true'`. `scripts/ci-ok.sh` is always-on: cheap path requires decide + `test:lib` + `page-budget`; full path requires every listed job `== success` including `obs-ui`. |
| Tests | `pnpm test:ci-cost` — docs-only ready PR does not launch heavy jobs; `ci-full` / dispatch / main still do; `ci-ok` rejects `skipped` on full and accepts those skips on cheap. |
| Mainnet | **Blocked** |

## Closed that run (#69 gap 2 — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Docs-only/trivial non-draft PRs skip unrelated heavy matrices | **Yes** | `scripts/ci-decide.sh` + `scripts/ci-cost.test.ts` |
| Force-full still runs every required job | **Yes** | `ci-full` / dispatch full / main cases in `test:ci-cost` |
| `ci-ok` rejects skips on the full path | **Yes** | `scripts/ci-ok.sh` + skipped-solidity/postgres/browser/`obs-ui` asserts |
| #15 / #17 / #18 commands unchanged | **Yes** | Same pnpm/forge job steps; only the `full` selector changed |
| #39 `obs-ui` folded on main | **Yes (source)** | Merged #46 / `789eb5c`. Job stays full-only. |
| One green protected-main full run including `obs-ui` | **No** | Still required before #69 can close. |
| Close #69 | **No** | Post-#46/#81 main green still needed. `Refs #69` only. |

---

# Prior — Production web observability (merged #46, Refs #39)

**Status:** Squash-merged **#46** (`789eb5c`) on `origin/main`. Refs **#39**. Rebased onto `4207356` (**#75** Restricted-access UX after **#44** E2E release gate / #70 / #79 / #68 / #67 / #66 / #49 / #50 / #42 / #58) before merge. This pass keeps **`obs-ui`** (production `next start`), first-party resolve, configured-DSN **staging vendor proof** (`obs/vendor-proof.test.ts`), and `/api/telemetry` **429 backpressure** so #49 `web-qa` does not treat Chromium ingest 429 as a page diagnostic (quote `?inject=quote-429` stays fail-visible). Live org/project still post-merge. **#39 stays open until post-merge live vendor verify.** #75 `/restricted` + disabled write CTAs stay from main. #70 sanctions ops docs/nav + #79 #17 evidence + #68 operator-policy + #67 geo + #66 OFAC stay from main. #44 `e2e-release-gate` stays from main.

**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Top-10 ranking / Keeper routing / Factory V1 constants: unchanged.**  
**#75 restricted-access UX (`/restricted`, `policy.ensureProof`, `test:restricted`): kept from main.**  
**#49 `web-qa` visual / a11y / `?inject=` + #42 leftover #17 gates (`docs:links`, Playwright `web`, `safe-genesis-builder.test.ts` in `test:lib`): kept.**  
**#47 CSP / tx-guard / untrusted metadata: kept.**  
**#68 operator-policy + recovered-wallet proof on Launch/trade: kept.**  
**#44 production-build browser + wallet E2E release gate (`e2e-release-gate`): kept.**  
**#50 indexed board + always-on `page-budget`: kept.**  

**#58 live-toasts / typecheck (`ohlcv-chart` `IChartApi` / `UTCTimestamp`): kept from main.**  
**#70 sanctions freshness SLA / `/ops` dataset card / sanctions-ops docs+nav: kept.**  

**#73 three-tier CI + #74 / #76 / #77 public-fork harden + rewrite + advertised-ref residual notes: kept.**  
**Merge train:** #46 landed **0.3.4** independently before docs PR **#48**. Later branches rebase onto 0.3.4 unless #54 `0.4.0` lands first. Do not restore **0.3.3**.

**Rebase (`4207356`):** mechanical replay of #39 onto #75 / #44 / #70 / #79 / #68. Shared `docs/*` / `docs-nav` / `/ops` / `package.json` / `TESTING` / `AUDIT_HANDOFF` / `trust.md` / `ci.yml` keep main's restricted-access UX, `e2e-release-gate`, operator-policy, sanctions freshness, #17 evidence cites, geo HMAC, and `@reactor/sanctions` fixtures; observability (`obs-ui`, error boundaries, vendor-proof, outage paging) stays. Launch/trade keep `policy.ensureProof` **and** `reactorFetch` / `SupportRef` plus #44 phase / submit-lock / receipt polling. Do not weaken restricted-access, operator-policy, or e2e-release-gate. No economics / Factory / hook rewrite.

| Item | Value |
| --- | --- |
| Protocol release | **0.3.4** (`docs/version.json`) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | Production web observability AC closure: Web Vitals, operator alert runbook, production failure-injection + redaction, user↔backend `traceId` correlation, wallet `4001` paging suppress, exact env/chain/build tags. Addresses #39 (do not close). `/api/reactor/top10` stays the #33 indexer proxy (no `discoverTop10`). |
| Foundry | Unchanged this pass (frontend ops only). Last recorded **326 passed**, 1 skipped on 0.3.1 |
| Indexer / lib | `pnpm test:lib` adds `obs/redact.test.ts` + `obs/telemetry.test.ts` + `obs/failure-injection.test.ts` + `obs/sourcemap.test.ts` + `obs/vendor-proof.test.ts` plus #75 `operator-policy-status` / `operator-policy-ux` / `operator-policy-evaluate` + `test:ci-cost` + `ci-public-harden.test.ts` + `pnpm docs:check`. Visible CI: **`obs-ui`**. |
| Review shots | Error-boundary + observability docs |
| Mainnet | **Blocked** |

## Closed that run (#39 ACs — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Sentry-or-equivalent + source maps / release SHA | **Yes — first-party + configured-DSN staging vendor proof; live org still a #39 close gate** | Optional Sentry store API (`sentry.ts`) now ships symbolicated `exception.stacktrace.frames`. Hidden maps + `*.map` 404. First-party VLQ resolve (`obs/sourcemap.ts`) maps a deliberate production throw to `obs-probe.ts`. `obs/vendor-proof.test.ts` POSTs that event to a valid DSN whose store is an in-process mock and asserts original filename + `reactor@0.3.4+SHA` / `LOCAL` / `5042002` / ISO build time. Uploader archives maps; `REACTOR_SOURCEMAPS_REQUIRE=1` fails closed. Live vendor UI verify stays post-merge. |
| Instrument API / RPC / wallet / quote / SSE / tx / media / simulation | **Yes** | `reactorFetch` + `reportFailure` / `maybeSimulation` in hooks, trade-panel, wallet-button, launch, sse, ops, BFF, Top-10 proxy |
| Privacy redaction (no secrets) | **Yes** | `redact.ts` — keys, mnemonic, JWT/Bearer, Turnstile, 65-byte sigs, cookies. BFF `acceptIngestedEvent` drops residual secrets. Tests |
| App + route error boundaries | **Yes** | `app/error.tsx`, `global-error.tsx`, `AppErrorBoundary`, per-route `error.tsx`. LOCAL `/error-preview` |
| Web Vitals / core-page performance | **Yes** | First-party `PerformanceObserver` (`web-vitals.ts`) rebinds on route. Kind `perf`. Core pages only. Production Playwright asserts a `perf` event on `/trade`. |
| Operator alert thresholds / runbook | **Yes** | `alerts.ts` + `/ops` table + `/docs/observability` runbook. Classes: render / api / rpc / quote / sse / simulation. Production Playwright asserts all six rows. |
| Production E2E failure-injection + redaction | **Yes** | `obs/failure-injection.test.ts` (PROD-shaped env) + Playwright `playwright.obs.config.ts` (`next start`, `REVIEW_FIXTURES=1`) clicks every outage-class inject. Anvil PK / mnemonic / sig sentinels stay redacted. Exact-head CI: `.github/workflows/ci.yml` job **`obs-ui`** (full / main). |
| User-visible ↔ backend/chain correlation | **Yes** | `traceId` + `x-request-id`. Trade / launch / fair / boundaries show `ref … · chain 5042002` |
| Wallet `4001` never pages | **Yes** | `isUserRejection` + `shouldPageOperator`. Unit + Playwright assert `page: false` |
| Exact env / chain / build timestamp tags | **Yes** | `releaseInfo()` + `/api/version` + Sentry tags. Tests assert exact `LOCAL` / `5042002` / `REACTOR local (Arc-compatible)` / ISO `buildTimestamp`, not only `reactor@0.3.4+SHA` |
| Docs / version | **Yes** | Still **0.3.4** (not 0.3.5, not restored 0.3.3). If #54 AutomationGateway `0.4.0` lands first, rebase onto that tip and do not restore 0.3.4. Parent `4207356` #75 / #44 / #70. `/docs/observability` staging vendor checklist. Trust + API + UX. `pnpm docs:check` |

---

# Prior — Restricted-access UX (merged #75, Refs #65)

**Status:** Squash-merged **#75** (`4207356`) on `origin/main`. Refs **#65** (child of RELEASE GATE **#60**). **Do not close #65, #63, or #60.** Frozen economics. No mainnet.
**Not audited. Not mainnet.**
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

Official **#62 / PR #68** and **#64 / PR #70** are on `main`. Hosted UX binds to `GET /operator-policy/status` (same `evaluateOperatorPolicy` as write gates) and `GET /operator-policy/challenge` (signing helper only). Disclosure matches merged #64: stale/missing official-list fail-closes operated writes and surfaces as temporarily unavailable. **#63** geo core is accepted on #67; founder **reopened #63** until this user-visible restricted state lands via #65 / #75.

## That HEAD (#65)

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Dedicated `/restricted` production state, disable operated write CTAs before wallet prompts, honest disclosure of hosted sanctions/geo controls and what they cannot do on permissionless chain reads. |
| Server dependency | Official #62 / #68 `apps/indexer/src/operator-policy.ts` + `packages/reactor/src/sanctions-policy.ts`. Decision read is `GET /operator-policy/status` (`readOperatorPolicyStatus` / same `evaluateOperatorPolicy` as write gates). No proof → `UNAVAILABLE_WALLET_MISSING` unless geo is independently `DENY`. Challenge is not a decision. Subject is the EIP-191 signer. Claimed browser wallet is ignored. |
| Tests | Follow-up after exact-head `c1f6a78` re-run [`34738474644`](https://github.com/solarcurvey/reactor/actions/runs/34738474644) failed `web-qa` on React #418 (hydration text/HTML) for denied `/restricted` a11y/reflow. Two hydrate races: (1) `useSearchParams` + text Suspense fallback vs the restricted tree; (2) mocked `/api/operator-policy` painting deny UI before a Suspense child hydrates. `/restricted` is a dynamic server page that passes `?kind=` into the client view (no client URL read during render). Provider refresh waits until after mount. `useOperatorPolicy()` stays pending until **that consumer** mounted (same class as WalletButton). Denied 320px / 200% reflow is one page per test. Diagnostics / axe / muted-text AA gates are unchanged. Prior green [`34738256919`](https://github.com/solarcurvey/reactor/actions/runs/34738256919) on `c1f6a78` is **not** the closer. `/restricted` muted copy is `text-zinc-400`. Production four-state AC closed on this PR. |
| Rebase | Onto `origin/main` `b190e86` (squash-merged **#44** after **#70** / `cc82cd4`). Same PR **#75** / same branch. Kept #44 `e2e-release-gate`, launch/trade phase + submit lock, and official-shaped `#68` `/operator-policy/status` on the #35 mock so invented `E2E_LOCAL` cannot fail-close ALLOW journeys. Official #61/#62 plugins and #64 ops are on `main`. #63 geo core is on `main` via #67 and **stays open** until this UX lands. Indexer uses canonical `operator-policy.ts`; bind is the #65 test/fixture adapter. |
| #44 coexistence | Exact-head full run [`34737996588`](https://github.com/solarcurvey/reactor/actions/runs/34737996588) on `311957f`: `web-qa` / `web-production-security` / `operator-policy-http` / Foundry / Postgres / `docs-links` green; `e2e-release-gate` failed only on `edge.spec.ts` “chain change mid-flow” — Playwright strict-mode, two “Wrong network” buttons (`trade-confirm` + `rewards-claim`). Locator now uses those test ids. Product copy unchanged. Ready-for-review rerun [`34738474644`](https://github.com/solarcurvey/reactor/actions/runs/34738474644) on `c1f6a78`: `e2e-release-gate` green; `web-qa` failed React 418 on denied `/restricted`+launch reflow (mocked `/api/operator-policy` could paint deny UI before hydrate). Provider now keeps the SSR pending tree until after mount (same pattern as WalletButton). `/restricted` no longer uses `useSearchParams`/Suspense. Denied 320px / 200% reflow is one page per test. |
| Mainnet | **Blocked** |

## Closed that run (#65 ACs — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Dedicated `/restricted` state | **Yes** | Server `apps/web/src/app/restricted/page.tsx` + client `restricted-view.tsx` + amber banner. `?kind=` is request-scoped (no `useSearchParams`) so production hydration matches. |
| Neutral account / location / temporary copy | **Yes** | `RESTRICTED_PAGE_COPY` + banner `data-kind` |
| Write CTAs disabled before wallet prompts | **Yes** | `useOperatedWrites` on trade / launch / fair / rewards |
| Public reads remain | **Yes** | Markets / search / token / docs routes unchanged |
| No IP / screening leak | **Yes** | Minimized `publicPolicyView` / official `publicStatusView` |
| No VPN / bypass guidance | **Yes** | `copyContainsForbiddenGuidance` |
| Honest onchain-cannot-censor disclosure | **Yes** | `RESTRICTED_DISCLOSURE` |
| Docs match #61–#64 | **Yes** | Restricted-access / trust / FAQ / index disclose 7-day SLA fail-closed, last-known-good, no hop analytics, no dataset hash in the browser. Production `next start` four-state matrix is in `e2e/restricted-prod.spec.ts`. Production a11y/reflow covers `/restricted` + denied launch/token. |
| Bind to #62 / #68 | **Yes** | Official `operator-policy.ts` on `main` |
| Close #65 / #63 | **No** | Stay open until #75 merges + post-merge verify. `Refs #65`. |

---

# Prior — Production-build browser + wallet E2E release gate (merged #44, Refs #35)

**Status:** Squash-merged **#44** (`b190e86`) on `origin/main`. Child of #15. Refs #35 / Refs #15 only (do not `Fixes` / `Closes` #35 or #15). Continues landing the production E2E gate for #15. Frozen economics / architecture. **Not audited. Not mainnet.**
**Economics / 3.5% / 2/1/0.5 / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## That HEAD (#35)

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Production `next build` + `next start` Playwright release gate with a deterministic EIP-1193 wallet fixture **and** a MetaMask/Rabby-style unpacked MV3 extension. Browser matrix Chromium / Firefox / WebKit plus iPhone-class and narrow-Android. Nested USDC BUY+SELL assert `UserRouteExecutor` target/calldata/result. Shared `console.error` / `pageerror` fixture fails teardown. No Anvil private keys, no mainnet keys, no isolated signer. |
| Proof | Rebased onto `main` `cc82cd4` (#70 sanctions freshness after #79 / #68 / #67 / #66 / #49 / #42 / #50 / #58). Kept #70 freshness/audit/alerts/runbook (`#64` stays open). Kept #79 accepted #17 / #42 evidence (`11fdadb` / `34727535121`, `80d3cac` / `34727638255`). Kept #68 operator-policy / wallet-proof. Kept #67 geo-policy tests in `test:lib`. Kept #66 `@reactor/sanctions` fixtures in `test:lib`. Kept #49 `web-qa` (visual / a11y / failure-injection). Ticket/launch phase lines use visible `text-zinc-400` (same AA muted floor as #49 — do not hide the line and do not weaken `assertNoSubAaMutedText`). Disconnect stays in the #49 Account modal. `/wallet` is a status card only — the header `WalletButton` is the single connect/account control (`wallet-menu-trigger` is unique). Ready graduate token stays on the E2E mock only — not an extra Discover fixture card. Rewards wallet copy waits until mount. WalletButton keeps the SSR Connect tree until hydrate so a second `page.goto` after EIP-1193 connect cannot React-418. Kept #42 `docs-links` / Playwright `web` / Safe genesis / solc prefetch. Kept #50 indexed search / `useSwapSeries` / `readTicketWallet` / always-on `page-budget`. Live quote default stays **30s** (`?? 30_000`); E2E short TTL is `NEXT_PUBLIC_QUOTE_TTL_MS` only. Mock indexer serves `#50` `GET /quote-assets`, `GET /markets/:token`, and `GET /page/token/:token`, plus `#68` `GET /operator-policy/challenge` and `GET /operator-policy/status` so quote/launch/upload can attach a wallet proof. EIP-1193 `rejectTx` is Confirm-buy / `eth_sendTransaction` only (challenge `personal_sign` auto-signs). Extension Quote Confirm covers the proof, then Confirm covers the trade. WebKit console-gate stays pinned to exact `/127.0.0.1:18448/stream` pageerror only. Home+launch waits for mock `GET /markets` before leaving `/` so iPhone WebKit does not abort that fetch and mis-report it as CORS. Indexed bonding/ready rows bind official `InstantCurve`; REVIEW_FIXTURES merge restores `curve` / `ready` / fixture quote on `/page/token` so BUY/graduate do not fall through to the router. `ci-ok` requires `e2e-release-gate` **and** `web-qa` **and** `page-budget`. #35 stays open until post-merge. **Refs #35 / Refs #15 only.** |
| Review shots | Refreshed for the visible AA `text-zinc-400` phase line (including quote-413 / wallet-revert / tx-reverted 1440). Discover board stays on the #49 fixture set (Ready is mock-only). Disconnect stays in the Account modal. `/wallet` no longer duplicates the header wallet control. |
| Mainnet | **Blocked** |

## Closed that run (#35 implementation)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Playwright against production Next | **Yes** | `playwright.release.config.ts` starts `e2e/harness/start-web.mjs` (`next build` then `next start :43147`). Mock indexer `:18448` (valid TCP port). Unblocked `next build` (launch `Link`, search `ticker`, tape `source`, OHLCV `Time`, exclude `e2e/` from app tsconfig). After #43, `live-toasts.ts` must import `./utils` — a `.ts` suffix fails `next build` (`allowImportingTsExtensions`). |
| Browser matrix | **Yes** | Desktop Chromium / Firefox / WebKit plus iPhone-class and narrow-Android production projects |
| Deterministic EIP-1193 wallet | **Yes** | `e2e/harness/wallet.ts` — Anvil #0/#1 **addresses only**, sessionStorage, EIP-6963 MetaMask+Rabby announce |
| Extension wallet (MetaMask/Rabby-style) | **Yes** | `e2e/extension` MV3 + `chromium-extension` project. Prompt: connect/confirm/reject/lock/account |
| Full ticket lifecycle | **Yes** | `data-testid=trade-phase` idle → quoting → approval/signature → submitted/pending → confirmed |
| Edge: switch/disconnect/lock/revert/allowance/TTL/drop/double-submit | **Yes** | `e2e/release/edge.spec.ts` |
| Dev Buy happy + failure | **Yes** | Factory `launchAndBuy`; authorize-down 503 |
| Shared suite flake | **Not this PR** | #59 on `main` injects `withFakeLeaseTime`. This branch does not widen TTL/renew on wall-clock and does not reintroduce a competing lease-test strategy. |
| BUY / SELL / nested / bonding / graduated | **Yes** | Router / InstantCurve / UserRouteExecutor `to` assertions |
| Launch + rewards | **Yes** | Factory Instant + `claimRewards` |
| Wrong-chain / reject | **Yes** | chainId 1 banner + switch; connect/tx `4001` |
| Frozen 3.5% / no FDV knobs | **Yes** | Launch + ticket copy asserts |
| Unexpected console.error / pageerror fail the suite | **Yes** | Shared `attachConsoleGate` on EIP-1193 and extension page fixtures. Records error-level `console` + `pageerror`. Documented allowlist: Chromium HTTP 503 on `/api/launch-pricing` (Dev Buy authorize-down); Next.js RSC prefetch fallback (iPhone WebKit + Firefox) / WebKit `?_rsc=` access-control; WebKit EventSource `/stream` access-control only (not `/markets` — mock JSON echoes Origin so indexed GETs are real CORS). Home+launch waits for mock `GET /markets` before `/launch`. Mock `/stream` and `json()` echo the request `Origin`. Teardown throws captured diagnostics. Trace/screenshot/network stay retain-on-failure. |
| Folded into #73 `ci.yml` | **Yes** | Full-only `e2e-release-gate`. `ci-ok` requires it **and** #49 `web-qa` **and** always-on `page-budget` from #50 **and** #42 `docs-links` / `web`. `scripts/ci-cost.test.ts` forbids `e2e-release.yml` and `web-qa.yml`. |
| Docs | **Yes** | `TESTING.md` §41 + table 49/49b, `AUDIT_HANDOFF.md`, `docs/builders.md`, `docs/ci.md`, `CHANGELOG` Unreleased, `pnpm docs:gen`. `docs:check` rejects leftover conflict markers. |


---

# Prior — Sanctions freshness, audit, alerts, runbook (merged #70, Refs #64)

**Status:** Squash-merged **#70** (`cc82cd4`) on `origin/main`. Same work as `cursor/sanctions-ops-freshness-8fcc`, rebased onto `35552f6` after **#79** / **#68** / **#67** / **#66**. Issue **#64 stays open** — use `Refs #64`, do not auto-close. Official `#61` refresh binds via `apps/indexer/src/sanctions.ts`. Official `#62` `operator-policy.ts` is the gated subject.
**Not audited. Not mainnet.**
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Persist official-list version/hash/retrieved/last-success; 7-day SLA fail-closed; startup + scheduled refresh keeps last-known-good; health + `/ops` name dataset + policy versions; minimized audit; alerts; operator runbook. HTTP identity is #62 recovered EIP-191 only. Fixture refresh LOCAL/test-only. Same-address refresh writes a new #61-style generation so restart freshness ages from t1. |
| Rebase | Onto `origin/main` `35552f6` after **#79** (#17 evidence) / **#68** (#62) / **#67** (#63) / **#66** (#61). Docs conflicts kept #79 accepted #17/#42 runs + closed #36/#37/#61/#62/#63 status, #62 `gateProtectedWrite` + challenge/status, #67 `evaluateRequestGeo`, #61 lookup, **and** #64 freshness. `applySanctionsOpsGate` loads merged `operator-policy.ts` (`recoverSubjectWallet` / `gateProtectedWrite`). Shared `#61` store is rebound via `bindOperatorPolicyProviders` so the gate does not construct a second ingest. Ops persist is `SANCTIONS_DATA_DIR/ops`. TESTING row 61. |
| Indexer / lib | `sanctions-ops.test.ts` + `sanctions-audit.test.ts` + indexer `sanctions-ops.test.ts` + `pnpm docs:check` |
| Docs | `/docs/sanctions-ops`, runbook, incident-response, trust, API, builders, TESTING row 61 |
| Mainnet | **Blocked** |

## Closed that run (#64 ACs — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Bad/partial refresh never replaces last-known-good | **Yes** | `packages/reactor/src/sanctions-ops.test.ts` |
| Stale policy fails protected writes (#62 codes) | **Yes** | `UNAVAILABLE_DATASET_STALE` on quote/admit/authorize/upload |
| Health/dashboard names exact dataset + policy versions | **Yes** | `GET /health` / `/sanctions/health` / `/ops` + web `/ops` card |
| Logging/redaction | **Yes** | `sanctions-audit.test.ts` |
| Failure injection → alert + degraded health | **Yes** | `refresh_fail` / `stale` / `policy_fail` raise `sanctions_*` and `degraded` |
| Runbook linked from incident-response | **Yes** | `docs/incident-response.md` → `docs/sanctions-runbook.md` |
| No automated complaint override | **Yes** | `NO_AUTOMATED_OVERRIDE` |
| Close #64 | **No** | Stays open until independent audit + post-merge verify |
| Claimed-wallet spoof cannot gate/log identity | **Yes** | `extractWallet()` is a no-op. Subject is #68 `wallet-proof` / `recoverOfficialSubject` |
| Fixture fallback LOCAL/test-only | **Yes** | Bound `#61` store on LOCAL loads pinned OFAC XML unless `SANCTIONS_NETWORK=1`. Shared-store rebind keeps `#62` LOCAL fixture screen |
| Same-address refresh restart-safe | **Yes** | Version id is `ofac-<content16>-<gen12>` or official #61 id |

---

# Prior — Cite accepted #17 / #42 CI evidence (docs-only, merged #79)

**Status:** Squash-merged **#79** (`35552f6`) on `origin/main`. **Refs #17**. Do not `Fixes #17`. Product work already landed via **#42** on `80d3cac`. Preserves integrated #62 operator-policy docs from #68, #63 geo-policy docs from #67, and #61 screening docs from #66. Current-status: #61 / #62 / #63 / #36 / #37 closed; **#17 stays open** until post-merge docs/CI after #79; **#60 / #64 / #65 / #69 stay open**.
**Not audited. Not mainnet.**
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Evidence / docs sync only. No workflow, test, or tokenomics edits. |
| Merge-candidate #42 | `11fdadb` / [`34727535121`](https://github.com/solarcurvey/reactor/actions/runs/34727535121) — exact-head `ci-ok` **success** |
| Post-merge #42 | `80d3cac` / [`34727638255`](https://github.com/solarcurvey/reactor/actions/runs/34727638255) — `ci-ok` **success** on integrated `main` |
| #37 / #50 | **Closed.** Post-merge `e5fd745` / [`34727279555`](https://github.com/solarcurvey/reactor/actions/runs/34727279555) |
| #36 / #49 | **Closed.** Merged `ad7b457` / [`34729758795`](https://github.com/solarcurvey/reactor/actions/runs/34729758795) (`web-qa` executed) |
| #61 / #66 | **Closed.** Merged `d08aa1c` / [`34731099571`](https://github.com/solarcurvey/reactor/actions/runs/34731099571) |
| #63 / #67 | **Closed.** Founder closed after post-merge verify. Merged `e712617` / [`34731788819`](https://github.com/solarcurvey/reactor/actions/runs/34731788819) |
| #62 / #68 | **Closed.** Merged `2002aed` / [`34733128955`](https://github.com/solarcurvey/reactor/actions/runs/34733128955) |
| #17 | **Stays open** until post-merge docs/CI after #79 |
| #60 / #64 / #65 / #69 | **Stay open.** |
| Mainnet | **Blocked** |

## Closed that run (docs only)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Cite accepted #17 / #42 runs | **Yes** | Merge-candidate `11fdadb` / `34727535121`; post-merge `80d3cac` / `34727638255`. Older greens are **not** the closer. |
| Record #37 / #36 / #61 / #63 / #62 closed | **Yes** | #50 `e5fd745` / `34727279555`; #49 `ad7b457` / `34729758795`; #66 `d08aa1c` / `34731099571`; #67 `e712617` / `34731788819`; #68 `2002aed` / `34733128955` |
| Preserve #66 / #67 / #68 docs | **Yes** | Operator-policy / geo / screening Priors below keep #68 AC table, HMAC / revision 3 / SY / FAQ 1009, and #61 parser / 85% floor / `screen()`. |
| `Fixes #17` | **No** | Refs only. Close #17 after post-merge docs/CI is green. |
| Claim #60 / #64 / #65 / #69 closed | **No** | Stay open. |
| Frozen economics / arch | **Yes** | No contract / fee / Factory / hook edits |

---

# Prior — merged #68 operator policy gate (#62 closed)

**Status:** Squash-merged **#68** (`2002aed`) on `origin/main`. Issue **#62 closed** after post-merge [`34733128955`](https://github.com/solarcurvey/reactor/actions/runs/34733128955). Child of RELEASE GATE **#60** (stays open). Address screen binds `#66` `indexerSanctionsStore().screen`. Trusted geo binds `#67` `evaluateRequestGeo`.
**Not audited. Not mainnet.**
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.** No new Guardian power.

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | One canonical server-side policy gate on REACTOR-operated write/authorization paths. Client-side blocking is insufficient. |
| Decision module | `packages/reactor/src/sanctions-policy.ts` — `allow` / `deny` / `unavailable` + machine reason codes |
| Wallet subject | EIP-191 recover of server challenge (`wallet-proof.ts`). Claimed wallet headers/JSON are not authority. |
| Enforcement | `apps/indexer/src/operator-policy.ts` `gateProtectedWrite` on admit / authorize / quote / upload / isolated signer; Next BFF forwards proof only |
| Address screen | Merged `#66` `indexerSanctionsStore().screen` / `GET /sanctions/screen` (lookup API stays ungated) |
| Trusted geo | Merged `#67` `evaluateRequestGeo` / `geo-policy-resolve.ts` |
| Status API (#65) | `GET /operator-policy/status` — minimized public decision (`publicStatusView`). Same gate. Official contract for PR #75. |
| Tests | Unit matrix + production-shaped indexer HTTP + Next `/api/launch-pricing` BFF. Denial before signer/upload/tx canary payloads. Status GET matrix. Official `#66` `sanctions.ts` + `#67` `geo-policy-resolve.ts` bind against `apps/indexer/src` (LOCAL FX DENY via official evaluator; HMAC `UA-14` oblast UNKNOWN; HMAC `UA-DPR` DENY). |
| Docs | `/docs/operator-policy`, trust, API, admission, FAQ, builders, SDK, TESTING row 60, `/docs/ci` |

## Closed that run (#62 ACs — issue closed after post-merge)

| Item | Closed? | Evidence |
| --- | --- | --- |
| One shared policy module | **Yes** | `evaluateOperatorPolicy` — no per-route ad hoc checks |
| allow / deny / unavailable + reason codes | **Yes** | `sanctions-policy.test.ts` |
| Fail closed on blocked or stale/unavailable | **Yes** | HTTP matrix + PROD-without-plugins 503 |
| Never trust browser clear/country/IP | **Yes** | Spoof headers/body still deny |
| Screen recovered signer, not claimed wallet | **Yes** | Sign-as-BLOCKED + `x-reactor-wallet`/`body.wallet=CLEAR` denies on admit/authorize/quote/upload/signer/BFF. `extractSubjectWallet` returns undefined. CORS does not permit `x-reactor-wallet`. |
| Real Next/indexer routes | **Yes** | Helper units plus `scripts/operator-policy-http.test.ts` (real `index.ts` + production `next start`). Full-only CI job `operator-policy-http` required by `ci-ok`. |
| Denial before payload | **Yes** | Canary signature/tx/upload absent; downstream counter |
| Public GET reads documented + unblocked | **Yes** | `/markets` `/health` `/ticker` `/operator-policy/challenge` `/operator-policy/status` `/sanctions/screen` |
| #65 status contract | **Yes** | `GET /operator-policy/status` + `publicStatusView` (no wallet/IP/SDN). PR #75 rebases onto this path. |
| Docs list exact surfaces | **Yes** | `/docs/operator-policy` |
| No economics redesign / no onchain-block claim | **Yes** | Disclaimer on every denial |
| Preserve #66 screening APIs | **Yes** | `GET /sanctions/screen`, `GET /sanctions/dataset`, `indexerSanctionsStore().screen` |
| Official #66+#67 plugin path | **Yes** | `tryBindOfficialPolicyPlugins` against `apps/indexer/src` binds both. Official `evaluateRequestGeo` exercised: LOCAL FX DENY, HMAC oblast UNKNOWN, HMAC covered-region DENY. |
| Close #62 | **Yes (later)** | Post-merge `2002aed` / [`34733128955`](https://github.com/solarcurvey/reactor/actions/runs/34733128955). Parent **#60** and **#64 / #65** stay open. |

---

# Prior — merged #67 trusted geo / jurisdiction policy (#63 closed)

**Status:** Merged **#67** (`e712617`) on `origin/main` after #66. Core geo layer accepted on post-merge [`34731788819`](https://github.com/solarcurvey/reactor/actions/runs/34731788819). Issue [#63](https://github.com/solarcurvey/reactor/issues/63) **closed** after founder post-merge verify.
**Not audited. Not mainnet.**
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Server-side geo policy interface: ALLOW / DENY / UNKNOWN + reason codes; trusted edge HMAC; versioned comprehensive-jurisdiction file with source + effective date; LOCAL fixtures that cannot load production denylists. |
| Indexer / lib | `packages/reactor/src/geo-policy.test.ts` + `apps/indexer/src/geo-policy.test.ts` + `pnpm docs:check` |
| Foundry | Not re-run this pass (offchain policy only) |
| Rebase | Onto `origin/main` `d08aa1c55bdfc20f9d93cc33446f9c5542a7d1da` after squash-merged **#66** (exact official-list OFAC screening / #61). Same PR **#67** / same branch. Founder re-audit: SY + oblast overblocks closed. Protocol **0.3.3** / Factory **V1** unchanged. |
| Mainnet | **Blocked** |

## Closed that run (#63 ACs — issue closed after post-merge)

| Item | Closed? | Evidence |
| --- | --- | --- |
| One server interface ALLOW / DENY / UNKNOWN + reasons | **Yes** | `evaluateGeoPolicy` / `evaluateRequestGeo` |
| Production geo from trusted edge only | **Yes** | HMAC headers; unsigned `CF-IPCountry` ignored |
| Versioned deny policy + source / effective date | **Yes** | `geo-policy-us-comprehensive.v1.json` **revision 3** / 2026-09-12. `CU`/`IR`/`KP` only. `SY` is `not_comprehensive` (E.O. 14312 / 2025-07-01; part 542 removed). Clear Syrian geo → ALLOW. |
| Region-level when metadata exists; else conservative UNKNOWN | **Yes** | UA without region → `UNKNOWN_REGION_METADATA_UNAVAILABLE` |
| E.O. 14065 oblast vs Covered Region (FAQ 1009) | **Yes (this HEAD)** | `UA-14` / `UA-09` / `Donetsk Oblast` / `Luhansk Oblast` → UNKNOWN, not DENY. Precise signed `UA-DPR` / `UA-LPR` or `DNR`/`DPR`/`LNR`/`LPR` / People's Republic names → DENY. Documented in `/docs/geo-policy`. |
| VPN/Tor best-effort only | **Yes** | `confidence: "best_effort"`; T1 → UNKNOWN |
| LOCAL/test fixtures; no accidental production list | **Yes** | Fixture `FX`/`FY`; `GEO_DENY_COUNTRIES` ignored on LOCAL |
| No UI country checks | **Yes** | Web source scan in `geo-policy.test.ts` |
| Docs + tests same change | **Yes** | `/docs/geo-policy`, trust, THREAT_MODEL, AUDIT_HANDOFF, TESTING row 59 |
| #61 / #62 / #64 / #65 | **Not this PR** | Out of scope of #67. #61 and #62 later closed; #64 / #65 stay open. |
| Independent audit 2026-09-12: stale `SY` blanket deny | **Fixed** | Removed `SY` from jurisdictions; `programNotes` + regression `signed({ country: "SY" })` → ALLOW. Targeted Syrian persons stay #61/#62. |
| Independent re-audit: whole-oblast `UA-14`/`UA-09` DENY | **Fixed this HEAD** | FAQ 1009. Oblast codes/names → UNKNOWN. Precise covered-region fixture → DENY. |
| Close #63 | **Yes (later)** | Founder closed after post-merge verify. `e712617` / [`34731788819`](https://github.com/solarcurvey/reactor/actions/runs/34731788819). |

---

# Prior — Trusted geo / jurisdiction policy (#63 / merged #67)

**Status:** Merged **#67** on `origin/main` `e712617`. Issue **#63 stays open** until independent audit + post-merge verify. Do not auto-close.  
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Server-side geo policy interface: ALLOW / DENY / UNKNOWN + reason codes; trusted edge HMAC; versioned comprehensive-jurisdiction file with source + effective date; LOCAL fixtures that cannot load production denylists. |
| Indexer / lib | `packages/reactor/src/geo-policy.test.ts` + `apps/indexer/src/geo-policy.test.ts` + `pnpm docs:check` |
| Foundry | Not re-run this pass (offchain policy only) |
| Rebase | Onto `origin/main` `d08aa1c` after squash-merged **#66** (exact official-list OFAC screening / #61). Founder re-audit: SY + oblast overblocks closed; #63 stays open until #62/#65 consume. |
| Mainnet | **Blocked** |

## Closed that run (#63 ACs — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| One server interface ALLOW / DENY / UNKNOWN + reasons | **Yes** | `evaluateGeoPolicy` / `evaluateRequestGeo` |
| Production geo from trusted edge only | **Yes** | HMAC headers; unsigned `CF-IPCountry` ignored |
| Versioned deny policy + source / effective date | **Yes** | `geo-policy-us-comprehensive.v1.json` **revision 3** / 2026-09-12. `CU`/`IR`/`KP` only. `SY` is `not_comprehensive` (E.O. 14312 / 2025-07-01; part 542 removed). Clear Syrian geo → ALLOW. |
| Region-level when metadata exists; else conservative UNKNOWN | **Yes** | UA without region → `UNKNOWN_REGION_METADATA_UNAVAILABLE` |
| E.O. 14065 oblast vs Covered Region (FAQ 1009) | **Yes** | `UA-14` / `UA-09` / `Donetsk Oblast` / `Luhansk Oblast` → UNKNOWN, not DENY. Precise signed `UA-DPR` / `UA-LPR` or `DNR`/`DPR`/`LNR`/`LPR` / People's Republic names → DENY. Documented in `/docs/geo-policy`. |
| VPN/Tor best-effort only | **Yes** | `confidence: "best_effort"`; T1 → UNKNOWN |
| LOCAL/test fixtures; no accidental production list | **Yes** | Fixture `FX`/`FY`; `GEO_DENY_COUNTRIES` ignored on LOCAL |
| No UI country checks | **Yes** | Web source scan in `geo-policy.test.ts` |
| Docs + tests same change | **Yes** | `/docs/geo-policy`, trust, THREAT_MODEL, AUDIT_HANDOFF, TESTING row 59 |
| #61 / #62 / #64 / #65 | **Not that PR** | Out of scope |
| Independent audit 2026-09-12: stale `SY` blanket deny | **Fixed** | Removed `SY` from jurisdictions; `programNotes` + regression `signed({ country: "SY" })` → ALLOW. Targeted Syrian persons stay #61/#62. |
| Independent re-audit: whole-oblast `UA-14`/`UA-09` DENY | **Fixed** | FAQ 1009. Oblast codes/names → UNKNOWN. Precise covered-region fixture → DENY. |
| Close #63 | **No** | Founder re-audit closed SY + oblast overblocks. Stays open until #62 enforcement + #65 UX consume, then post-merge verify. |

---

# Prior — Exact official-list sanctions screening (Refs #61)

**Status:** Squash-merged **#66** (`d08aa1c`) on `origin/main`. Issue **#61 closed** after post-merge [`34731099571`](https://github.com/solarcurvey/reactor/actions/runs/34731099571). Parent RELEASE GATE **#60** stays open. Issue **#61 stays open** until post-merge verify (parent RELEASE GATE **#60**). Do not auto-close. **Status:** Merged **#42** on `origin/main` `80d3cac` after **#50** `e5fd745` / **#58** `c03c698`. Issue **#17 stays open**. **Not audited. Not mainnet.** Tokenomics unchanged. ---

# Prior — Eliminate RPC waterfalls (#37 / #50)

**Status:** Merged **#50** on `origin/main` `e5fd745` after **#58** `c03c698`. Issue **#37 stays open**. **Not audited. Not mainnet.** Tokenomics unchanged. ---

# Prior — Exact official-list sanctions screening (Refs #61 / merged #66)

**Status:** Landed on `origin/main` as **`d08aa1c`** (#66) after **#49** (UI QA) on #42 / #50 / #58. Issue **#61 stays open** until post-merge verify (parent RELEASE GATE **#60**). Do not auto-close.
**Not audited. Not mainnet. Not a legal/OFAC compliance claim.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**  
**Protocol release remains 0.3.3** — do not restore a pre-rewrite version.

**Re-audit pass (source integrity):** default refresh is SDN **and** Consolidated (classic + advanced). Completeness floor is **85%** of prior addresses and per-source counts, plus a 50% per-source byte floor. `allowCatastrophicShrink` / `SANCTIONS_ALLOW_SHRINK=1` is the only override.

**Re-audit pass (freshness durability):** version id includes `sourceGenerationHash` (retrievedAt + source HTTP/publication metadata), not only the address-set `contentHash`. A same-address refresh persists t1 metadata; `loadFromDisk()` freshness ages from t1.

**Rebase (after #49 / `ad7b457`):** replayed the #61 commits onto `origin/main` `ad7b457`. Conflicts (docs/`package.json` only — no economics rewrite): `package.json` `test:lib` keeps **#61** sanctions fixtures **and** #49 `qa-inject` / console-gate / contrast **and** #42 `safe-genesis` / `docs:links` / `test:web-unit` **and** #50 `indexed` / `page-budget`; `TESTING.md` row 52 stays #61 (53–56 #50, 57 #42, 58 #49); `docs/trust.md` keeps fail-visible UI + screening; `docs/ci.md` keeps always-on `page-budget`, full-only `web-qa` / `docs-links` / Playwright `web`, **and** the #61 fixture slot; `AUDIT_HANDOFF.md` / `BUILD_REPORT.md` keep #61 + #49 + earlier amendments. `#73` single `ci.yml` + `#72/#74/#76/#77` harden kept. Live OFAC HTTPS stays `SANCTIONS_NETWORK=1` / `test:sanctions:network` — not a second workflow. Do not restore `docs-sync.yml` or `web-qa.yml`.

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | #61 ingestion + exact `screen()` library/API from official Treasury/OFAC machine-readable sources. Atomic last-known-good. Explicit `blocked` / `clear` / `unavailable`. |
| Indexer / lib | `packages/sanctions` parser/store/screen + `apps/indexer` `GET /sanctions/screen` + `GET /sanctions/dataset` + ops refresh |
| Foundry | Not re-run (no Solidity) |
| Mainnet | **Blocked** |

## Closed that run (#61 ACs — issue closed after post-merge)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Parser regression (EVM case, duplicates, malformed, non-EVM families) | **Yes** | `packages/sanctions/src/normalize.test.ts`, `parse.test.ts` |
| Default refresh includes Consolidated; consolidated-only address blocked | **Yes** | `refresh.test.ts` (TRX + XRP after default source set) |
| Atomic update; last-known-good on bad **or** valid-but-gutted parse | **Yes** | `store.test.ts` 10→1 floor; `refresh.test.ts` `truncated_valid.xml` |
| Explicit shrink override only | **Yes** | `allowCatastrophicShrink` / `--allow-shrink` / `SANCTIONS_ALLOW_SHRINK=1` |
| Server-usable lookup + dataset version/freshness | **Yes** | `screen.test.ts`, `http.test.ts`, `apps/indexer/src/sanctions-api.test.ts`, `GET /sanctions/screen` |
| CI fixtures; network refresh isolated | **Yes** | unit scripts + `pnpm --filter indexer test`; `test:sanctions:network` / `SANCTIONS_NETWORK=1` only |
| Docs / runbook; no compliance / hop claim | **Yes** | `SANCTIONS.md`, `/docs/sanctions`, trust, API, admission hooks for later #60 children |
| Full #60 gate / geo / UX | **No** | Intentionally out of scope. Comments only. |
| Close #61 | **Yes (later)** | Post-merge `d08aa1c` / [`34731099571`](https://github.com/solarcurvey/reactor/actions/runs/34731099571). Parent **#60** stays open. |

---

# Prior — merged #49 UI QA visual / a11y / failure-injection (#36)

**Status:** Merged **#49** (`ad7b457`) on `origin/main`. Issue **#36 closed** after post-merge [`34729758795`](https://github.com/solarcurvey/reactor/actions/runs/34729758795) (`web-qa` executed).
**Not audited. Not mainnet.**  
**Architecture / economics / Factory V1: unchanged.**

Full-only job `web-qa` (`pnpm --filter web test:qa`) plus cheap units in `test:lib` (`qa-inject`, console-gate, contrast). `ci-ok` requires `web-qa`. Pixel baselines live on #49.

---

| Blocker | Why |
| --- | --- |
| Public mainnet (5042) | Hard blocked. No addresses. |
| Claim Arc Multicall3 exists | Probe only. Do not hardcode yes. |
| Close #37 | **Closed** after #50 `e5fd745` / [`34727279555`](https://github.com/solarcurvey/reactor/actions/runs/34727279555). |
| Close #10 | Stays open (merged #53). Do not `Fixes #10`. |
| Top-10 as onchain oracle | Frozen offchain by design. TTL is offchain policy. |

---

# Prior — merged #58 next-build lint / typecheck

**Status:** Merged on `origin/main` `c03c698`. `ohlcv-chart.tsx` lint/typecheck only. Architecture and tokenomics unchanged.

---

# Prior — CI cost cut without weakening release gates (Refs #69)

**Status:** Merged **#73** (`300b7e5`) on `origin/main`. Issue **#69 stays open** until post-merge verify. Cost/frequency refactor only. #15 / #17 / #18 production-readiness commands stay reachable.
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**  
**Visibility was NOT changed.**

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Eliminate duplicate feature-branch `push` + `pull_request` heavy jobs; concurrency cancel; three-tier fast / full / main; path-aware fail-safe; fewer VMs; exact-head auditability. |
| Workflows | Single `.github/workflows/ci.yml`. Removed `docs-sync.yml` / `live-toasts.yml` / `keeper-lease-pg.yml` (jobs folded, commands kept). |
| #74 / #76 / #77 harden kept | Workflow `permissions: contents: read`; every `actions/checkout` has `persist-credentials: false`; no `pull_request_target`. `scripts/ci-public-harden.test.ts` still in `test:lib`. |
| Fast PR | `constants-version-deployments` = `pnpm test:lib` (units + cheap security + `docs:check` + `test:ci-cost` + `ci-public-harden`). Targeted Foundry when Solidity paths change. |
| Full / main | Production Next + XSS (`web-production-security`), `live-toasts-ui`, full Foundry + Attack + CREATE2 + `size:guard`, Postgres `test:pg` + `test:pg-lease` + `pg-smoke`, `ci-ok` (skipped ≠ pass). |
| Docs | `/docs/ci` before/after inventory. `TESTING.md`, `CONTRIBUTING.md`, `AUDIT_HANDOFF.md`. |
| Mainnet | **Blocked** |

## Closed that run (#69 ACs — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| No duplicate heavy push+PR for the same feature-branch SHA | **Yes** | Feature-branch `push` omitted. `scripts/ci-cost.test.ts` forbids a bare `push:`. |
| Superseded PR runs cancel | **Yes** | `concurrency` group per PR; `cancel-in-progress` true except `refs/heads/main`. |
| Cheap PR gate still catches compile/unit/docs/security | **Yes** | `pnpm test:lib` on every PR update. |
| Full suite on exact merge-candidate SHA | **Yes** | Non-draft / `ci-full` / `workflow_dispatch`. Checkout `head.sha`. |
| One main post-merge path | **Yes** | `push: branches: [main]`, concurrency keyed by SHA. |
| Docs-only does not launch heavy matrices | **Yes** | `scripts/ci-paths.sh`; full tier ignores filters. |
| Required jobs cannot succeed without commands | **Yes** | No `continue-on-error`. `ci-ok` requires `success`, not `skipped`. |
| #35–#41 / #51 / #60 tests unchanged in substance | **Yes** | Same pnpm/forge commands. Slots documented for sibling PRs. |
| Before/after inventory | **Yes** | `/docs/ci` — typical agent rebase 10 jobs → 1–2 jobs. |
| #74 / #77 public-fork harden survives the fold | **Yes** | `persist-credentials: false` on every checkout; `ci-public-harden.test.ts` green. |

---

# Prior — Founder residual decision for #72 (advertised-ref AC1)

**Status:** Merged **#77** (`0db39c0`) on `origin/main`. Issue **#72 stays open**. Do not `Fixes #72`.  
**Not audited. Not mainnet.**  
**Visibility was NOT changed.**

Founder (Davis): Support purge/GC of pre-rewrite dangling SHAs is **not required**. Residual old-SHA exposure is accepted. AC1 is email scrubbed from **advertised** refs only.

---

# Prior — History rewrite to noreply + prune (Refs #72 / #76)

**Status:** Merged **#76** (`0bd9b82`) after **#74**. Issue **#72 stays open** until founder AC verify (visibility flip is still a founder gate). Do not `Fixes #72`.
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**  
**Visibility was NOT changed. History WAS rewritten (founder-authorized).**

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Remap personal-mailbox `Co-authored-by` trailers to GitHub noreply; force-update `main` + open PR heads; prune leftover `cursor/*`; re-scan; land #74 hardening on rewritten `main`. |
| Pre-rewrite `main` | `c15956196418baca76280b9c6d98c11f3cbb24c9` |
| Post-rewrite `main` | `a56065016731ac9af93b3aaec0bd896a94cc3397` then #74 squash `6b328373650722df480e744da26dbb6f4cfb7386` |
| Tag `v0.3.1` | `e398fd4` → `d60d3158d7b2401bd71ff38fc10b9c598c07be35` |
| Workflows | Unchanged vs #74: `contents: read` + `persist-credentials: false`. No `pull_request_target`. Compatible with #69 / PR #73. |
| Invariant test | `scripts/ci-public-harden.test.ts` inside `pnpm test:lib` |
| Docs | `/docs/publicization` rewrite notes + SHA map |
| Mainnet | **Blocked** |

## Closed that run (#72 ACs — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Personal email removed from advertised refs (AC1) | **Yes** | `git log --all --format='%ae %ce %B' \| grep -i gmail` empty on `main` + open PR heads + tags. Residual `refs/pull/*` dangling objects accepted. |
| Merged/superseded Cursor branches pruned | **Yes** | 10 leftovers + merged #74 head deleted. 16 open-PR heads remain. |
| Full-history secret scan | **Yes** | gitleaks 8.24.3 (32 fixture hits) + trufflehog 3.88.29 (11 unverified, 0 verified). **0 live credentials.** |
| Real credential rotated | **Yes (none found)** | Nothing to rotate. |
| Public-fork Actions harden | **Yes** | #74 merged onto rewritten `main`. |
| #69 cost controls compatible | **Yes** | Additive permissions only. PR #73 force-updated to rewritten history. |
| Final audit/scan notes | **Yes** | `/docs/publicization` |
| Visibility flip | **Not done** | FOUNDER DECISION GATE. |
| Close #72 | **No** | Stays open. |

---

# Prior — Repo publicization inventory + public-fork CI harden (Refs #72 / #74)

**Status:** Merged **#74** onto rewritten `main`. Issue **#72 stays open**.  
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**  
**Visibility was NOT changed.**

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Inventory reachable refs / emails / secrets; harden Actions for a possible future public repo; write the operator checklist. |
| Workflows | Additive: `permissions: contents: read` + `persist-credentials: false` on `docs-sync.yml` / `live-toasts.yml` / `keeper-lease-pg.yml`. |
| Invariant test | `scripts/ci-public-harden.test.ts` inside `pnpm test:lib` |
| Docs | `/docs/publicization` + nav, policy, trust, FAQ, glossary, CONTRIBUTING, TESTING, THREAT_MODEL, AUDIT_HANDOFF |
| Mainnet | **Blocked** |
| #69 | Merged #73 folds those files into `ci.yml` and keeps the harden. |

---

# Prior — merged #47 Untrusted token metadata / CSP (#41)

**Status:** Merged on `main` `d0142a4` (PR **#47**). Issue **#41 stays open** until post-merge verify. Independent audit kept #41 open; this prior records the AC gaps closed on that PR.
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Close remaining #41 ACs: production-build header/browser suite; client-bundle secret sentinel; XSS corpus + layout; tx-guard (metadata cannot steer wallet; chain mismatch blocks writes); production `script-src` nonce (no `'unsafe-inline'`). |
| Indexer / lib | `untrusted-metadata.test.ts` + `security-headers.test.ts` + `tx-guard.test.ts` + `secret-sentinel.test.ts` + `admission-unit.test.ts` + `pnpm docs:check` |
| Web production | `pnpm test:web-security` — `next build` + live CSP/headers + `.next/static` scan + Playwright corpus. CI job `web-production-security`. |
| Foundry | Not re-run this pass (web/admission only) |
| Mainnet | **Blocked** |

## Closed on #47 (#41 ACs — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Security suite vs production build + live headers | **Yes** | `e2e/prod-security.spec.ts` + `playwright.prod-security.config.ts` (`next start`). CI `web-production-security`. |
| Client-bundle secret sentinel | **Yes** | `secret-sentinel.test.ts` + `scripts/scan-client-bundle.ts`. No `NEXT_PUBLIC_*` for Keeper/Launch/Guardian keys or private RPC. |
| Browser XSS corpus + long/bidi/invisible layout | **Yes** | Review fixtures XSS/LONG. Playwright home/search/terminal/toasts/activity. `UntrustedText` isolate + wrap. |
| Metadata cannot steer wallet; chain mismatch blocks | **Yes** | `tx-guard.ts` / `tx-guard.test.ts`. Trade / launch / fair / claim wired. Indexer `tx` discarded. |
| Production `script-src` `'unsafe-inline'` | **Yes (replaced)** | Middleware nonce + `strict-dynamic`. Residual `'unsafe-inline'` is **`style-src` only** — documented in `/docs/web-security`. |
| Rebase onto #43 / `5fba655` | **Yes** | Kept #43 live toasts + #53 TTL / `quote_lp` / no mint-supply fallback. TESTING row 50 = #53; row 51 = #41 prod suite; row 52 = #36 QA gate. |
| Docs | **Yes** | `/docs/web-security`, trust, TESTING row 51, CHANGELOG, THREAT_MODEL, HARDENING_REPORT, AUDIT_HANDOFF |

---

# Prior — merged #43 live CORE / Top-10 buy+burn toasts (Refs #38)

**Status:** Merged on `main` `5fba655`. Issue **#38 stays open** until post-merge verify.  
**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## That HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | P2 live UI: bottom-right confirmed CORE and Top-10 buy+burn notifications (Refs #38). Canonical `(chainId, txHash, logIndex, eventKind)` seen-set outlives the visible toast array. |
| Foundry | Unchanged this pass (no Solidity). |
| Indexer / lib | `sse.test.ts` + `live-sse.test.ts` + `apps/web/src/lib/live-toasts.test.ts` + Playwright `e2e/live-toasts.spec.ts` + CI job **`live-toasts-ui`** + `pnpm docs:check` |
| Review shots | Live toast chrome is new; fixture board otherwise unchanged |
| Mainnet | **Blocked** |

## Closed this run (AC on #38 — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Confirmed-only (post-commit SSE) | **Yes** | Indexer publishes after `persistTickBatch`. First-session `hello.head` + `id > cutoff` |
| Canonical dedupe | **Yes** | `(chainId, txHash, logIndex, eventKind)`. Module session `seen` survives dismiss and remount. Same-tx distinct-log Top10Buy stay two notices |
| Reconnect without loss/dup/history storm | **Yes** | Cutoff never raised. `?after=` / `Last-Event-ID`. `live-toasts.test.ts` + Playwright |
| Hover/focus pause + safe-area + reduced-motion | **Yes** | Clock helpers + `e2e/live-toasts.spec.ts` |
| CORE / Top-10 only | **Yes** | Not SelfBurn, not epoch, not holder burn, not mempool |
| Visible CI/release gate | **Yes** | `.github/workflows/ci.yml` job `live-toasts-ui` (full/main) |
| Docs | **Yes** | `/docs/events`, `/docs/traders`, `/docs/core`, `/docs/top-10`, `/docs/api`, `UX_REFERENCE.md` |
| Tokenomics / Factory | **Unchanged** | No contract edits |
| Close #38 | **No** | Stays open until `live-toasts-ui` is green on main and post-merge verify. Do not `Fixes #38`. |

---

# Prior — merged #53 Top-10 fail-closed gaps after #33 (Refs #10)

**Status:** Merged on `main` `c2b84ff`. Issue **#10 stays open** — use `Refs #10`, do not auto-close.  
**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Keeper routing / Factory V1 constants: unchanged.**

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — Unreleased notes only |
| Factory | **V1** — unchanged |
| Intent | Close three post-#33 fail-closed gaps: snapshot TTL, indexed liquidity, no mint-supply fallback. |
| Foundry | Unchanged this pass (offchain ranking / API / Keeper only). |
| Indexer / lib | `top10-rank.test.ts` + `packages/reactor/src/top10.test.ts` cover TTL serve + Keeper refuse, `quote_lp` liquidity arm, empty `current_supply` pause. |
| Review shots | **Not regenerated** (no UI chrome change) |
| Mainnet | **Blocked** |

## Closed this run (AUDIT BLOCKED on #10)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Stale snapshot serve | **Yes** | `resolveTop10Serve` + `TOP10_SNAPSHOT_TTL_SEC`. Fresh healthy → age past TTL → refresh throws → paused empty rows. Keeper `acceptTop10Snapshot` refuses the same payload. Tick `persistPausedTop10` replaces the last healthy row. |
| Real liquidity materiality | **Yes** | `liquidityUsdc` from `graduations.quote_lp` / `markets.real_quote`. Source assert forbids `lastGoodMarkUsdc / 5`. Unvalued + ≥ floor/5 indexed LP pauses; dust LP does not. |
| `current_supply` fail-closed | **Yes** | Ranker reads `t.current_supply` only. Empty after v9 pauses; mint `tokens.supply` is not a fallback. |
| Docs | **Yes** | `docs/top-10.md`, `docs/markets.md`, `docs/api.md`, `docs/keeper.md`, `KEEPER_MODEL.md`, `AUDIT_HANDOFF.md`, `CHANGELOG.md` Unreleased. |

## Still blocked (do not fake)

| Blocker | Why |
| --- | --- |
| Public mainnet (5042) | Hard blocked. No addresses. |
| Close #10 | Stays open until post-merge verify. Do not `Fixes #10`. |
| Top-10 as onchain oracle | Frozen offchain by design. TTL is offchain policy. |

---

# Prior — merged #33 Top-10 ValuationService

# BUILD REPORT — Keeper lease unit tests (CI flake after #47)

**Status:** Restore green `docs-sync` / `constants-version-deployments` on main `d0142a47` (#47). `pnpm --filter indexer test` failed in `keeper.lease.test.ts` with `renewed leader still holds after work > TTL`. The dedicated two-worker Postgres job on the same SHA was green.  
**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Keeper routing / Factory V1 constants: unchanged.** Production lease SQL, fence, and default `Date.now()` + `setInterval` renew are unchanged.

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — notes only |
| Factory | **V1** — unchanged |
| Intent | Make Keeper lease TTL / renew / steal proofs deterministic via an injected clock. CI load after #47 could delay `setInterval` past a 400ms test TTL so a follower stole mid-tick. |
| Foundry | Unchanged this pass. |
| Indexer / lib | `keeper.lease.test.ts` + `keeper.lease.pg.test.ts` drive `lease-clock.fake.ts`. Added a no-renew regression (work > TTL loses the fence). `pnpm --filter indexer test` must stay green. |
| Review shots | **Not regenerated** (no UI) |
| Mainnet | **Blocked** |

## Closed this run

| Item | Closed? | Evidence |
| --- | --- | --- |
| docs-sync `pnpm --filter indexer test` flake | **Yes** | Injected clock + scheduler; long-tick AC no longer waits on wall clock |
| Silent skip of the renew AC | **No** | Same assertion; plus explicit no-renew takeover case |
| Production lease semantics | **Unchanged** | `wallLeaseRenewScheduler` is still `setInterval`; Store still writes `leaseNow()` which defaults to `Date.now()` |
| Broader Keeper / re-audit | **Left open** | Offchain test harness only. Push for re-audit; do not close unrelated issues. |

---

# Prior — Top-10 ValuationService rebase onto post-#30 main

# BUILD REPORT — Top-10 ValuationService rebase onto post-#30 main

**Status:** Same PR **#33** / same branch `cursor/top10-valuation-service-5a26`, rebased onto latest `origin/main` `80c3c20` (#30 consensus **v10** after #23 `current_supply` **v9**). Issue **#10 stays open** until merge + post-merge verify.  
**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — notes only |
| Factory | **V1** — unchanged |
| Intent | Replace web `discoverTop10` Factory RPC with canonical indexer ValuationService snapshot (issue #10). Schema **v11** is uniquely Top-10 candidate tables. Do not reintroduce or collide with v9/v10. |
| Foundry | Unchanged this pass (offchain ranking only). |
| Indexer / lib | `pnpm --filter indexer test` green locally (includes `top10-rank.test.ts`, `top10.test.ts`, `schema.test.ts` v8→v11 / v9→v11 / v10→v11). `tsx apps/web/src/lib/top10.test.ts` + `marketdata.test.ts` green. `pnpm docs:check` green. CI on PR #33: `constants-version-deployments`, `postgres-ms-timestamps`, `two-worker-postgres` green. |
| Review shots | **Not regenerated** (no UI chrome change; route now proxies indexer) |
| Mainnet | **Blocked** |

## Closed this run (AUDIT BLOCKED on #10)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Rank from persisted `current_supply` | **Yes** | `loadGraduatedMarkets` reads `COALESCE(NULLIF(t.current_supply,''), t.supply)`. Writers remain #23. |
| Top-10 tables uniquely v11 | **Yes** | `SCHEMA_VERSION = 11`. v9 stays `current_supply`, v10 stays `kind`. Venue mark stays column-gated. |
| Web / Keeper consume one snapshot | **Yes** | `/api/reactor/top10` proxies `GET {indexer}/top10`. Keeper + watchdog read the same payload. |
| Nested marks via ValuationService | **Yes** | `top10-rank.test.ts` |
| No `discoverTop10` / 0.30% fallback | **Yes** | Source asserts in `top10-rank.test.ts` |
| Scale / no O(N) RPC | **Yes** | 8k indexed markets + fetch stub |

## Still blocked (do not fake)

| Blocker | Why |
| --- | --- |
| Public mainnet (5042) | Hard blocked. No addresses. |
| Independent re-audit | Required before merge of #10. |
| Top-10 as onchain oracle | Frozen offchain by design. |
| Close #10 | Stays open until merge + post-merge verify. |

---

# Prior — merged #30 external price consensus

# BUILD REPORT — Protocol 0.3.3 external price consensus

**Status:** Continue on existing REACTOR Origin repo. Parent `0b94d67` (#23 `current_supply` **v9** on `26cf6aa` / #32 after #31). Schema **v10** is `external_price_marks.kind`. Same PR #30.  
**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | Generalize external USD marks: configured provider registry, multi-source consensus, persist accept/reject, fail closed for launch + material Top-10. Addresses #11. Schema **v10** adds `external_price_marks.kind` after merged #23 **v9** `current_supply`. Arc sanity reads `route_venues.last_price_quote_x18` (column-gated; no v11). Rebased onto post-#23 main `0b94d67`. |
| Foundry | Unchanged this pass (offchain pricing only). Last recorded **326 passed**, 1 skipped on 0.3.1 |
| Indexer / lib | `pnpm --filter indexer test` includes `pricing.test.ts` + `price-marks.test.ts` + `ingest.valuation.test.ts` + `quote.test.ts` + `markets-query.test.ts` + real v8→v10 and v9→v10 upgrades in `schema.test.ts` + `pnpm docs:check` |
| Review shots | **Not regenerated** this pass (no UI change) |
| Mainnet | **Blocked** |

## Closed this run (#11 / PR #30)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Hardcoded ZEC/WBTC price-marks branches | **Yes** | `price-registry.ts` + `config/price-providers.json`. Tests in `pricing.test.ts`, `price-marks.test.ts` |
| Single HTTP source / silent static PROD fallback | **Yes** | Important assets `minSources=2`. Static skipped in PROD. Persist `ok=0` |
| Consensus without persisted rejects | **Yes** | Schema **v10** `kind=observation\|consensus` on `external_price_marks` after #23 **v9** `current_supply`. Watchdog `/pricing/health`. Real v8→v10 and v9→v10 upgrades in `schema.test.ts` |
| Arc sanity skipped in production (synthetic `markets` row in the regression) | **Yes** | `loadVerifiedVenueUsd6` reads the verified `route_venues` mark. Test seeds hookless quote↔USDC only (no `markets` row) and proves `arcUsd6` is obtained and >400 bps HTTP consensus is rejected. |
| ValuationService vs a second pricer | **Yes** | Store loads latest consensus only. Ranker `consumeIndexerValuation` fail-closes when reachable |
| Guardian quote with no providers | **Yes** | Scheduled as unconfigured; launch disabled until `/pricing/health` is ok |
| Docs / version | **Yes** | 0.3.3 patch on top of 0.3.2. `pnpm docs:check` |

---

# Prior — merged #23 burn-adjusted USD FDV on main

# BUILD REPORT — burn-adjusted USD FDV (issue #8)

**Status:** Rebased onto latest `main` (`26cf6aa` — #32 BUILD_REPORT cleanup after #31/#24/#22/#25/#28/#21/#27). Main schema remains **v8**; `tokens.current_supply` is **v9**. #32/#31/#24/#22 did not consume a schema version.  
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## Amendment — `tokens.current_supply` schema v9

`GET /markets` `fdv_usd6` uses `tokens.current_supply` (**schema v9**, next free after main/`#27` v8 journal identity; #32/#31/#24/#22/#25/#28/#21 did not consume a schema version). `/markets` SELECT lives in `listMarkets` (`markets-query.ts`) after #22. Column **tracks** remaining `totalSupply()` — not TokenCreated `tokens.supply`, not a protocol-event sum, not claimed ≡. Public `burn()` is `Transfer` to zero and/or `Burned` via canonical `(chain_id, tx, log_index, event_kind)`. Those token-level burn writes share the `persistTickBatch` transaction with `indexer_state` (no post-cursor `persistTokenBurnLogs` window). Protocol SelfBurn/Top10/COREBurned are attribution only. Bounded `totalSupply()` reconcile runs every tick including at head (corrects missed / same-tx Transfer+Burned; it does not restore skipped journal rows). Migration tests start from a real post-#27 v8 DB (full journal identity, then strip only `current_supply`). Architecture and tokenomics unchanged. No mainnet. Leave #8 open.

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.2** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Burn-adjusted `/markets` FDV (`Addresses #8`). Schema v9 after main v8. Canonical burn identity in the same `persistTickBatch` transaction as the cursor. Bounded `totalSupply()` reconcile. |
| Indexer / lib | `ingest.valuation.test.ts` + `schema.test.ts` + `markets-query.test.ts` (#22) + `read-json-body.test.ts` (#24) + `quote.test.ts` (#31) + `quote-integrity.test.ts` + `quote-sell-floors.test.ts` + `keeper.lease.test.ts` + `tick-atomic.test.ts` (SQLite + Postgres burn+cursor) + `pg-ms-timestamps.test.ts` v8→v9 + `pg-smoke.ts` + `pnpm --filter indexer test` + `pnpm docs:check` |
| Foundry | Not re-run this pass. Last recorded **326 passed**, 1 skipped on 0.3.1 |
| Mainnet | **Blocked** |

---

# Prior — Issue #5 nested fee-leg disclosure on main+#24+#22+#25+#21+#28

**Status:** Squash-merged to `main` @ `07ac5d0` (parent `b17e190` — #24 JSON body limits on #22 markets keyset / candle bounds on #25 Keeper fencing + #21+#28 quote pipeline). Leftover rebase conflict markers from #31 head `92f035c` removed in #32 (`26cf6aa`). Accepted `discloseSelectedRoute` + per-denom UI kept. No `bestPreview`.
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 unchanged.**

`feeLegs[]` come from `discloseSelectedRoute(selectAtomicQuotedRoute(scored), hops, { terminal market })`. No independent `bestPreview`. Compound 688 bps and `exemptOfficialLegs[]` kept. Regression: max raw output ≠ scored winner.

Trade ticket (`trade-panel.tsx` + `fee-legs.ts`) formats each official `feeLegs[]` entry with that hop’s quote asset and decimals (ZEC-8 vs ZCAT-18). Combined split is emitted only when every official leg shares one quote token + decimals. Otherwise the aggregate is `aggregateProtocolImpactBps` only. Regression: `fee-legs.test.ts`. Issue **#5 stays open**.

# Prior — Issue #13 public JSON body limits

# BUILD REPORT — Issue #4 SELL floors on shared #21 preview (parent)

**Status:** Parent `59478f2` (#22 markets keyset on #25). SELL floors consume the shared selected `PreviewedRoute` / `splitPreviewRoute`. No second candidate/preview implementation.  
**Not audited. Not mainnet.**  
**Architecture / economics unchanged.**

Quote API SELL tickets take `minQuoteOut` from `assembleAtomicTicket.terminalMinOut` (first-leg quoteOut) and `minFinalOut` from `minOut` (final USDC). Routed sells without a selected `PreviewedRoute` fail closed. Direct bonding/graduated sells wrap the first-leg quoteOut through the same `splitPreviewRoute`. Evidence: `quote-integrity.test.ts` (#3) + `quote-sell-floors.test.ts` (#4) together. Issue #4 stays open pending re-audit.

# Prior — Issue #3 route candidate integrity

# BUILD REPORT — Protocol 0.3.2

**Status:** Keeper lease fencing on main @ `59478f2` (#22 on #25, after #28 SELL floors, #21 route integrity and #27 atomic ingest). Dual-Postgres two-worker proof + CI kept. Issue **#6 stays open**.  
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This PR (P1 public JSON body limits)

**Issue:** [#13](https://github.com/solarcurvey/reactor/issues/13) — public JSON POSTs could buffer unbounded bodies.  
**Economics / architecture / Factory V1 / mainnet: unchanged.** Rebased onto main after #19 / #20 / #26 / #27 / #21 / #28 / #25 / #22.

| Item | Status | Evidence |
| --- | --- | --- |
| Stream cap on public JSON POSTs | **Yes** | 16KiB default / 64KiB hard max (`JSON_BODY_LIMIT_BYTES` cannot exceed hard max). `/quote`, `/launch/admit`, `/launch/authorize` |
| Chunked Transfer-Encoding | **Yes** | Cap is byte-count on the stream, not Content-Length alone |
| 413 + destroy | **Yes** | `BodyTooLargeError`; socket destroyed at first overflowing byte |
| Next BFF + isolated signer | **Yes** | Same 16KiB cap; signer stays fail-closed on missing store (#26) |
| Upload | Unchanged | Still 2MB stream; #20 key = `/m/<id>.webp` |
| Regression tests | **Yes** | `apps/indexer/src/read-json-body.test.ts`, `apps/web/src/lib/limited-json.test.ts` |
| Docs | **Yes** | `/docs/api`, `/docs/builders`, `/docs/trust`, `/docs/admission`, `THREAT_MODEL.md`, `AUDIT_HANDOFF.md` |

**Status:** Continue on existing REACTOR Origin repo. Parent `59478f2` (#22 on #25/#28/#21/#27/#26/#20/#19). Local Anvil 5042002 + Arc Public Testnet probe only.  
**Not audited. Not mainnet. Arc Public Testnet Factory create not claimed unless an explorer hash exists.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This PR (Keeper lease fencing)

Issue #6: a ~50s `leader_locks` TTL is shorter than possible tick work (`waitForTransactionReceipt` 60s; discovery/sim loops). Without renew, a standby can acquire mid-tick and both daemons broadcast.

| Item | Proof |
| --- | --- |
| Live leader renews `lease_until`, fence (`ts`) unchanged | `renewLease` / `withLeaderLock` interval |
| Pre-send renew; lost fence refuses broadcast | `withBroadcastFence` in `submitOnce` |
| Stale generation cannot delete a newer row | `releaseLease(name, owner, ts)` |
| Regression | SQLite `keeper.lease.test.ts`; two-worker Postgres `test:pg-lease` (CI `postgres-ms-timestamps` + `keeper-lease-pg`) |
| Docs | `docs/keeper.md` Operations, `KEEPER_MODEL.md`, `THREAT_MODEL.md` |
| Protocol / Factory | **0.3.2 / V1** (from #19). This PR does not bump semver. No mainnet. |

## Prior HEAD (#25 / #21)

| Item | Value |
| --- | --- |
| Protocol release | **0.3.2** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Issue #5 nested `feeLegs[]` from scored winner + terminal, squash-merged as #31 (`07ac5d0`). Parent includes #24 JSON body limits, #22 markets keyset, #25 lease fencing, #28 SELL floors, #21 route integrity, #27 atomic indexer. |
| Indexer / lib | `quote.test.ts` + `quote-api.test.ts` + `quote-integrity.test.ts` (#5/#3); `read-json-body.test.ts` (#24) + `markets-query.test.ts` (#22) + `keeper.lease.test.ts` + `test:pg-lease`; `quote-sell-floors.test.ts` (#28) + `tick-atomic.test.ts` (#27); `pnpm --filter indexer test` |
| Foundry | `UserRoute.t.sol` previewBuy/previewSell decode `hopOuts.length == hops.length + 1` (from #21 on main; not re-run this pass) |
| Mainnet | **Blocked** |

## Closed on main (#21)

| Leftover | Closed? | Evidence |
| --- | --- | --- |
| `quote-service` mix of `bestPreview` (max `finalOut`) with a differently scored `pickBest` route | **Yes (main #21)** | `quote-select.ts` binds the whole `PreviewRoute` to the pickBest winner. Routing-hop outs/kinds (`plannedHops`) are split from the terminal official/bonding slot (`plannedHops + 1`). BUY and SELL regressions decode `PreviewRoute`. Foundry `previewBuy`/`previewSell` assert `hopOuts.length == hops.length + 1`. |

---

# Prior — Protocol 0.3.2

**Status:** Continue on existing REACTOR Origin repo. Parent `9f29527` (#20 media key/URL on #19 BIGINT, Factory V1).  
**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## Prior HEAD (0.3.2)

| Item | Value |
| --- | --- |
| Protocol release | **0.3.2** (`docs/version.json`) — not bumped this rebase (indexer durability on top of #19/#20/#26) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | P1 indexer: event writes (including token burn journal) + cursor advance are one transaction; append-only `(chain_id, tx, log_index, event_kind)` + address journal (issue #8 crash window; leave #8 open) |
| Foundry | Not re-run this pass. Last recorded **326 passed**, 1 skipped on 0.3.1 |
| Indexer / lib | `tick-atomic.test.ts` SQLite + Postgres; `pnpm --filter indexer test` (includes `pricing-signer-store.test.ts` + `media-r2.test.ts`); `pnpm docs:check` |
| Review shots | **Not regenerated** this pass (no UI change) |
| Mainnet | **Blocked** |

## Closed this pass (P1 #7)

| Item | Closed? | Evidence |
| --- | --- | --- |
| `tick()` wrote events then `setState` cursor after the loop | **Yes** | `persistTickBatch` — one `BEGIN` / `BEGIN IMMEDIATE` for protocol rows, token `Burned` / `Transfer` to zero, and `indexer_state.block` / `block_hash`. RPC (logs, timestamps, head hash) first. SSE after commit. |
| Crash after some events / before cursor | **Yes** | Injected crash on `indexer_state` or mid-batch write rolls both back. SQLite + Postgres in `tick-atomic.test.ts`; Postgres also in `pg-smoke.ts`. |
| Reorg rewind `block` then `block_hash` split | **Yes** | `rewindIndexerCursor` is one transaction. Crash on the second write leaves the previous pair. |
| Postgres UNIQUE inside the tick transaction | **Yes** | Statement `SAVEPOINT` so caught `23505` does not abort the batch. Replay of the same logs stays idempotent. After `ROLLBACK TO SAVEPOINT`, the savepoint is `RELEASE`d. Prefer `ON CONFLICT DO NOTHING` on log identity. |
| Append-only event identity too coarse | **Yes** | Schema **v8** (v6 remains BIGINT ms from #19; v7 was `(chain_id, tx, log_index)`): shared `indexer_event_journal` PK `(chain_id, tx, log_index, event_kind)` plus `address`; side tables unique on the same tuple. Inserts pass real `logIndex` + `chainId` + Solidity event name. Two identical same-kind logs in one tx both persist; two kinds at the same log index both persist; replay does not duplicate; other `chain_id` does not collide. |

Honesty: 0.3.0 docs already said “Store work uses real transactions.” That was true for admission/locks, **not** for ingest cursor vs events. This pass makes that sentence true for `tick()`.

## Closed this run

| Item | Closed? | Evidence |
| --- | --- | --- |
| `openStore().catch(() => undefined)` signer bypass | **Yes** | `openSignerStore` + `requireDurableStore`. `SIGNER_STORE_UNAVAILABLE` → 503 |
| Receipt consume + issuance bucket skipped without store | **Yes** | `consumeDurableAdmission` always runs before EIP-712. Missing `id` refused |
| Health without store | **Yes** | Isolated signer `/health` requires `durableStore()` |
| Regression tests | **Yes** | `apps/indexer/src/pricing-signer-store.test.ts` |
| Launch Admission / Trust Model docs | **Yes** | `LAUNCH_ADMISSION.md`, `docs/admission.md`, `docs/trust.md`, `THREAT_MODEL.md` |
| Postgres INTEGER overflow on `Date.now()` ms | **Yes (main #19)** | Schema v6 `BIGINT`. Kept in this 0.3.2 changelog |
| R2/S3 key = public `/m/<id>.webp` | **Yes (main #20)** | `mediaObjectKey` / `assertMediaKeyMatchesPublicUri`. `media-r2.test.ts` |

## API P1 (this branch) — markets cursor + candle bounds

Rebased onto main `788ba84` (#25 Keeper lease fencing, after #28/#21). Indexer-only. Architecture / economics / Factory V1 / no mainnet: **unchanged**. Fixes #9 (leave open until merged + verified).

| Item | Status | Proof |
| --- | --- | --- |
| `GET /markets` keyset uses the same column as `sort` (`new`/`vol`/`price`) | **FIXED** | `markets-query.ts` + `markets-query.test.ts` (page-all uniqueness + `sort=price` not paging on `updated_ts`) |
| Insert-ahead between pages | **FIXED** | `markets-query.test.ts` — new higher-ranked row omitted; no duplicates (not a frozen snapshot) |
| `GET /candles/:token` gap-fill bounded; `before` exclusive like SQL | **FIXED** | `exclusiveBeforeBucket` + `prices.test.ts` (aligned `before=300` has no `t=300`; page N/N+1 no overlap; historical `before` stays in the past) |
| API docs | **Yes** | `docs/api.md`, `docs/markets.md`, `docs/examples.md`, `docs/traders.md`, `docs/builders.md`, `docs/sdk.md` |

## Still blocked (do not fake)

| Blocker | Why |
| --- | --- |
| Public mainnet (5042) | Hard blocked. No addresses. |
| Independent Codex / professional audit | Not performed. Do not claim audited. |
| Top-10 as onchain oracle | Frozen offchain by design. |
| Arc Factory claimed | No funded `ARC_TESTNET_PK` in this environment. |

## EIP-170 sizes

Unchanged from 0.3.1. Factory **stays V1**.

| Contract | Runtime (bytes) | Gate |
| --- | ---: | --- |
| ReactorFactory | **23,286** | ≤ 23,552 **pass** |

## Honest gaps that remain

- Unix-seconds INTEGER columns still hit the year-2038 wall on Postgres. Not this P0.
- LOCAL Turnstile bypass when secret unset (explicit LOCAL only).
- Funding-parent is a heuristic (ASN + /16 + optional first-USDC-funder).
- Factory runtime must stay under the CI margin.
- Full 24h `rollMarketAggregations` and `populateExternalPriceMarks` still run **after** the tick commits. Incremental 24h rolls stay inside the transaction. A crash there can leave stale aggregates until the next tick.
- SSE is after commit — a crash between commit and publish loses the live event (clients reconnect / HTTP).
- Ingest tick has no single-writer lease. Two indexer processes rely on UNIQUE + savepoints, not a lock.
- Process-kill mid-transaction is covered by DB rollback, not a kill -9 fixture in CI.

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.