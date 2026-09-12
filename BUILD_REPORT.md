# BUILD REPORT — Protocol 0.3.3 Top-10 ValuationService

**Status:** Continue on existing REACTOR Origin repo. Stacked on #23 (`57c140b`, `current_supply` v9) after main `#27` (`b4bf25d`) and consuming #30 consensus marks.  

**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Keeper routing / Factory V1 constants: unchanged.**

## Amendment — burn-adjusted USD FDV (issue #8)

Rebased onto `main` after #27 merged (`b4bf25d`). `GET /markets` `fdv_usd6` uses `tokens.current_supply` (**schema v9**, next free after #27 v7 log identity + v8 journal/`event_kind`). Column **tracks** remaining `totalSupply()` — not TokenCreated `tokens.supply`, not a protocol-event sum, not claimed ≡. Public `burn()` is `Transfer` to zero and/or `Burned` via canonical `(chain_id, tx, log_index, event_kind)`. Protocol SelfBurn/Top10/COREBurned are attribution only. Bounded `totalSupply()` reconcile runs every tick including at head (corrects missed / same-tx Transfer+Burned). Architecture and tokenomics unchanged. No mainnet. Leave #8 open.

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) — #27 journal + #23 `current_supply` + #30 consensus + #10 Top-10 |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | Replace web `discoverTop10` RPC fanout with canonical indexer ValuationService snapshot (issue #10). Rank from persisted `current_supply`. Consume #30 consensus marks (`ad5292b`, kind = v10, v9 reserved). |
| Foundry | Unchanged from 0.3.1 (**326 passed**) — no contract edits |
| Indexer / lib | `pnpm --filter indexer test` includes `top10-rank.test.ts` + `price-marks.test.ts` + `pricing.test.ts` + `ingest.valuation.test.ts` + `tick-atomic.test.ts` + `pnpm docs:check` |
| Mainnet | **Blocked** |

## Closed this pass (P1 #7, already on parent)

| Item | Closed? | Evidence |
| --- | --- | --- |
| `tick()` wrote events then `setState` cursor after the loop | **Yes** | `persistTickBatch` — one `BEGIN` / `BEGIN IMMEDIATE` for log-derived rows + `indexer_state.block` / `block_hash`. RPC (logs, timestamps, head hash) first. SSE after commit. |
| Crash after some events / before cursor | **Yes** | Injected crash on `indexer_state` or mid-batch write rolls both back. SQLite + Postgres in `tick-atomic.test.ts`; Postgres also in `pg-smoke.ts`. |
| Reorg rewind `block` then `block_hash` split | **Yes** | `rewindIndexerCursor` is one transaction. Crash on the second write leaves the previous pair. |
| Postgres UNIQUE inside the tick transaction | **Yes** | Statement `SAVEPOINT` so caught `23505` does not abort the batch. Replay of the same logs stays idempotent. After `ROLLBACK TO SAVEPOINT`, the savepoint is `RELEASE`d. Prefer `ON CONFLICT DO NOTHING` on log identity. |
| Append-only event identity too coarse | **Yes** | Schema **v8** (v6 remains BIGINT ms from #19; v7 was `(chain_id, tx, log_index)`): shared `indexer_event_journal` PK `(chain_id, tx, log_index, event_kind)` plus `address`; side tables unique on the same tuple. Inserts pass real `logIndex` + `chainId` + Solidity event name. Two identical same-kind logs in one tx both persist; two kinds at the same log index both persist; replay does not duplicate; other `chain_id` does not collide. |

Honesty: 0.3.0 docs already said “Store work uses real transactions.” That was true for admission/locks, **not** for ingest cursor vs events. #27 on parent makes that sentence true for `tick()`.

## Closed this run

| Item | Closed? | Evidence |
| --- | --- | --- |
| Web Top-10 enumerates Factory + values markets | **Yes** | `/api/reactor/top10` proxies `GET {indexer}/top10`. Source assert in `top10-rank.test.ts` |
| Keeper vs public page drift | **Yes** | Both read persisted `top10_candidate_epochs` payload |
| Burn-adjusted supply | **Yes** | persisted `current_supply` (holder `Burned` + `totalSupply()` reconcile). SelfBurn/Top10Buy attribution does not move rank |
| Nested marks via ValuationService | **Yes** | NESTED/ZCAT/ZEC fixture in `top10-rank.test.ts` |
| Consensus marks | **Yes** | Consumes #30 `kind=consensus` / `source=fused` rows. Schema **v10** (v9 reserved for #23) |
| Hardcoded ZEC/WBTC price-marks branches | **Yes** | `price-registry.ts` + `config/price-providers.json` |
| Stale external fail-closed | **Yes** | prior-ranked ZEC leaf pauses epoch |
| CORE excluded data-plane | **Yes** | CORE fixture never in rows |
| Scale / no O(N) RPC | **Yes** | 8k indexed markets + fetch stub; 0 HTTP/RPC during rank |
| Assumed 0.30% hookless fallback | **Yes** | Removed from `marketdata.ts` |
| Schema v11 Top-10 tables | **Yes** | After #23 v9 `current_supply` + #30 v10 `kind` (v9 reserved) |

## Still blocked (do not fake)

| Blocker | Why |
| --- | --- |
| Public mainnet (5042) | Hard blocked. No addresses. |
| Independent Codex / professional audit | Not performed. Do not claim audited. |
| Top-10 as onchain oracle | Frozen offchain by design. External USD marks are the same trust class. |
| Arc Factory claimed | No funded `ARC_TESTNET_PK` in this environment. |
| Merge-train rebase after #23/#30 land | #30 (`ad5292b`) assigns `kind` to **v10** and reserves **v9** for #23 `current_supply`. This stack matches that map and puts Top-10 tables at **v11**. After those PRs merge, rebase again — do not reuse v7/v8/v9. Keep #10 open. |

## EIP-170 sizes

Unchanged from 0.3.1. Factory **stays V1**. Top-10 ranking is off-Factory.

| Contract | Runtime (bytes) | Gate |
| --- | ---: | --- |
| ReactorFactory | **23,286** | ≤ 23,552 **pass** |

## Honest gaps that remain

- LOCAL may still use an explicit static ZEC mark when no HTTP URLs are set.
- Public HTTP hosts (CoinGecko / Coinbase / Kraken parsers) are operator-configured, not a trustless feed.
- Thin or missing Arc venues skip the 400 bps sanity band rather than inventing a pool price.
- Unix-seconds INTEGER columns still hit the year-2038 wall on Postgres. Not this P0.
- LOCAL Turnstile bypass when secret unset (explicit LOCAL only).
- Funding-parent is a heuristic (ASN + /16 + optional first-USDC-funder).
- Factory runtime must stay under the CI margin.
- Full 24h `rollMarketAggregations` and `populateExternalPriceMarks` still run **after** the tick commits. Incremental 24h rolls stay inside the transaction. A crash there can leave stale aggregates until the next tick.
- SSE is after commit — a crash between commit and publish loses the live event (clients reconnect / HTTP).
- Ingest tick has no single-writer lease. Two indexer processes rely on UNIQUE + savepoints, not a lock.
- Process-kill mid-transaction is covered by DB rollback, not a kill -9 fixture in CI.
- Top-10 remains trusted offchain computation.

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.
