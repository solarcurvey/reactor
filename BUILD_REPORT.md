# BUILD REPORT — Exact official-list sanctions screening (Refs #61)

**Status:** Branch `cursor/ofac-sanctions-dataset-1a33` / draft PR **#66**. Issue **#61 stays open** for independent audit (parent RELEASE GATE **#60**). Do not auto-close.  
**Not audited. Not mainnet. Not a legal/OFAC compliance claim.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

**Re-audit pass (source integrity):** default refresh is SDN **and** Consolidated (classic + advanced). Completeness floor is **85%** of prior addresses and per-source counts, plus a 50% per-source byte floor. `allowCatastrophicShrink` / `SANCTIONS_ALLOW_SHRINK=1` is the only override.

**Re-audit pass (freshness durability):** version id includes `sourceGenerationHash` (retrievedAt + source HTTP/publication metadata), not only the address-set `contentHash`. A same-address refresh persists t1 metadata; `loadFromDisk()` freshness ages from t1.

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | #61 ingestion + exact `screen()` library/API from official Treasury/OFAC machine-readable sources. Atomic last-known-good. Explicit `blocked` / `clear` / `unavailable`. |
| Indexer / lib | `packages/sanctions` parser/store/screen + `apps/indexer` `GET /sanctions/screen` + `GET /sanctions/dataset` + ops refresh |
| Foundry | Not re-run (no Solidity) |
| Mainnet | **Blocked** |

## Closed this run (#61 ACs — issue stays open)

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
| Close #61 | **No** | Stays open for re-audit. `Refs #61`. |

---

# Prior — merged #49 UI QA visual / a11y / failure-injection (#36)

**Status:** Merged **#49** (`ad7b457`) on `origin/main`. Issue **#36 stays open** until post-merge verify. Do not auto-close.  
**Not audited. Not mainnet.**  
**Architecture / economics / Factory V1: unchanged.**

Full-only job `web-qa` (`pnpm --filter web test:qa`) plus cheap units in `test:lib` (`qa-inject`, console-gate, contrast). `ci-ok` requires `web-qa`. Pixel baselines live on #49.

---

# Prior — CI cost cut without weakening release gates (Refs #69)

**Status:** Merged **#73** (`300b7e5`) on `origin/main`. Issue **#69 stays open**. Cost/frequency refactor only. #15 / #17 / #18 production-readiness commands stay reachable.  
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

## Closed this run (#69 ACs — issue stays open)

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

## Closed this run (#72 ACs — issue stays open)

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
