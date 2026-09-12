# BUILD REPORT — burn-adjusted USD FDV (issue #8)

**Status:** Rebased onto latest `main` (`788ba84` — #25 Keeper fencing on #28/#21/#27). Main schema remains **v8**; `tokens.current_supply` is **v9**.  
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## Amendment — `tokens.current_supply` schema v9

`GET /markets` `fdv_usd6` uses `tokens.current_supply` (**schema v9**, next free after main/`#27` v8 journal identity; #21/#28/#25 did not consume a schema version). Column **tracks** remaining `totalSupply()` — not TokenCreated `tokens.supply`, not a protocol-event sum, not claimed ≡. Public `burn()` is `Transfer` to zero and/or `Burned` via canonical `(chain_id, tx, log_index, event_kind)`. Protocol SelfBurn/Top10/COREBurned are attribution only. Bounded `totalSupply()` reconcile runs every tick including at head (corrects missed / same-tx Transfer+Burned). Migration tests start from a real post-#27 v8 DB (full journal identity, then strip only `current_supply`). Architecture and tokenomics unchanged. No mainnet. Leave #8 open.

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.2** (`docs/version.json`) — **unchanged** |
| Factory | **V1** — **unchanged** |
| Intent | Burn-adjusted `/markets` FDV (`Addresses #8`). Schema v9 after main v8. Canonical burn identity. Bounded `totalSupply()` reconcile. |
| Indexer / lib | `ingest.valuation.test.ts` + `schema.test.ts` + `quote-integrity.test.ts` + `quote-sell-floors.test.ts` + `keeper.lease.test.ts` + `tick-atomic.test.ts` + `pnpm --filter indexer test` |
| Foundry | Not re-run this pass. Last recorded **326 passed**, 1 skipped on 0.3.1 |
| Mainnet | **Blocked** |

---

# Prior — Issue #4 SELL floors on shared #21 preview

**Status:** On main @ `d084c47` (#28). SELL floors consume the shared selected `PreviewedRoute` / `splitPreviewRoute`. No second candidate/preview implementation.  
**Not audited. Not mainnet.**  
**Architecture / economics unchanged.**

Quote API SELL tickets take `minQuoteOut` from `assembleAtomicTicket.terminalMinOut` (first-leg quoteOut) and `minFinalOut` from `minOut` (final USDC). Routed sells without a selected `PreviewedRoute` fail closed. Direct bonding/graduated sells wrap the first-leg quoteOut through the same `splitPreviewRoute`. Evidence: `quote-integrity.test.ts` (#3) + `quote-sell-floors.test.ts` (#4) together. Issue #4 stays open pending re-audit.

# Prior — Issue #3 route candidate integrity

# BUILD REPORT — Protocol 0.3.2

**Status:** Keeper lease fencing rebased onto main @ `d084c47` (#28 SELL floors, after #21 route integrity and #27 atomic ingest). Dual-Postgres two-worker proof + CI kept. Issue **#6 stays open**.  
**Not audited. Not mainnet.**  
**Architecture / economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

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
| Intent | Issue #6 Keeper lease fencing on current main (after #28). Issue **#6 stays open**. |
| Indexer / lib | `keeper.lease.test.ts` + `test:pg-lease`; `quote-sell-floors.test.ts` (#28) + `quote-integrity.test.ts` (#21) + `tick-atomic.test.ts` (#27); `pnpm --filter indexer test` |
| Foundry | `UserRoute.t.sol` previewBuy/previewSell decode `hopOuts.length == hops.length + 1` (from #21 on main) |
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
| Intent | P1 indexer: event writes + cursor advance are one transaction; append-only `(chain_id, tx, log_index, event_kind)` + address journal (issue #7; leave open until merged+verified) |
| Foundry | Not re-run this pass. Last recorded **326 passed**, 1 skipped on 0.3.1 |
| Indexer / lib | `tick-atomic.test.ts` SQLite + Postgres; `pnpm --filter indexer test` (includes `pricing-signer-store.test.ts` + `media-r2.test.ts`); `pnpm docs:check` |
| Review shots | **Not regenerated** this pass (no UI change) |
| Mainnet | **Blocked** |

## Closed this pass (P1 #7)

| Item | Closed? | Evidence |
| --- | --- | --- |
| `tick()` wrote events then `setState` cursor after the loop | **Yes** | `persistTickBatch` — one `BEGIN` / `BEGIN IMMEDIATE` for log-derived rows + `indexer_state.block` / `block_hash`. RPC (logs, timestamps, head hash) first. SSE after commit. |
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
