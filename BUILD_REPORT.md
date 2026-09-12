# BUILD REPORT — Untrusted token metadata / CSP (#41)

**Status:** Same PR **#47** / same branch `cursor/harden-untrusted-metadata-csp-6228`, rebased onto latest `origin/main` `5fba655` (#43 live CORE/Top-10 toasts after #53/#33/#30). Independent audit kept #41 open; this HEAD keeps the AC gaps closed on that PR (no duplicate). Issue **#41 stays open** until merge + post-merge verify.
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Close remaining #41 ACs: production-build header/browser suite; client-bundle secret sentinel; XSS corpus + layout; tx-guard (metadata cannot steer wallet; chain mismatch blocks writes); production `script-src` nonce (no `'unsafe-inline'`). |
| Indexer / lib | `untrusted-metadata.test.ts` + `security-headers.test.ts` + `tx-guard.test.ts` + `secret-sentinel.test.ts` + `admission-unit.test.ts` + `pnpm docs:check` |
| Web production | `pnpm test:web-security` — `next build` + live CSP/headers + `.next/static` scan + Playwright corpus. CI job `web-production-security`. |
| Foundry | Not re-run this pass (web/admission only) |
| Mainnet | **Blocked** |

## Closed this run (#41 ACs — issue stays open)

| Item | Closed? | Evidence |
| --- | --- | --- |
| Security suite vs production build + live headers | **Yes** | `e2e/prod-security.spec.ts` + `playwright.prod-security.config.ts` (`next start`). CI `web-production-security`. |
| Client-bundle secret sentinel | **Yes** | `secret-sentinel.test.ts` + `scripts/scan-client-bundle.ts`. No `NEXT_PUBLIC_*` for Keeper/Launch/Guardian keys or private RPC. |
| Browser XSS corpus + long/bidi/invisible layout | **Yes** | Review fixtures XSS/LONG. Playwright home/search/terminal/toasts/activity. `UntrustedText` isolate + wrap. |
| Metadata cannot steer wallet; chain mismatch blocks | **Yes** | `tx-guard.ts` / `tx-guard.test.ts`. Trade / launch / fair / claim wired. Indexer `tx` discarded. |
| Production `script-src` `'unsafe-inline'` | **Yes (replaced)** | Middleware nonce + `strict-dynamic`. Residual `'unsafe-inline'` is **`style-src` only** — documented in `/docs/web-security`. |
| Rebase onto #43 / `5fba655` | **Yes** | Kept #43 live toasts + #53 TTL / `quote_lp` / no mint-supply fallback. TESTING row 50 = #53; row 51 = #41 prod suite. |
| Docs | **Yes** | `/docs/web-security`, trust, TESTING row 51, CHANGELOG, THREAT_MODEL, HARDENING_REPORT, AUDIT_HANDOFF |

---

# Prior — merged #43 Live CORE / Top-10 buy+burn toasts (Refs #38)

# BUILD REPORT — Live CORE / Top-10 buy+burn toasts (Refs #38)

**Status:** Rebased onto latest `origin/main` `c2b84ff` (#53 Top-10 fail-closed after #33). Issue **#38 stays open** — use `Refs #38`, do not auto-close.  
**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

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
| Visible CI/release gate | **Yes** | `.github/workflows/live-toasts.yml` job `live-toasts-ui` |
| Docs | **Yes** | `/docs/events`, `/docs/traders`, `/docs/core`, `/docs/top-10`, `/docs/api`, `UX_REFERENCE.md` |
| Tokenomics / Factory | **Unchanged** | No contract edits |
| Close #38 | **No** | Stays open until `live-toasts-ui` is green on main and post-merge verify. Do not `Fixes #38`. |

---

# Prior — merged #53 Top-10 fail-closed gaps after #33 (Refs #10)

# BUILD REPORT — Top-10 fail-closed gaps after #33 (Refs #10)

**Status:** Fresh branch off latest `origin/main` `0c30029` (PR **#33** merged). Issue **#10 stays open** — use `Refs #10`, do not auto-close.  
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
