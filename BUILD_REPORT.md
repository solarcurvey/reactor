# BUILD REPORT — Protocol 0.3.3 external price consensus

**Status:** Continue on existing REACTOR Origin repo. Parent `b4bf25d` (protocol 0.3.2: #19 BIGINT + #20 media + #26 signer fail-closed + #27 event identity / tick atomicity, Factory V1).  
**Not audited. Not mainnet.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.3** (`docs/version.json`) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | Generalize external USD marks: configured provider registry, multi-source consensus, persist accept/reject, fail closed for launch + material Top-10. Addresses #11. Schema **v10** adds `external_price_marks.kind` after #27 v7/v8 (v9 reserved for #23 `current_supply`). Rebased onto `b4bf25d`. Land before the final #29 Top-10 rebase so ranker tests run against this consensus schema. |
| Foundry | Unchanged this pass (offchain pricing only). Last recorded **326 passed**, 1 skipped on 0.3.1 |
| Indexer / lib | `pnpm --filter indexer test` includes `pricing.test.ts` + `price-marks.test.ts` + `tick-atomic.test.ts` + 0.3.2 signer/media tests + v8→v9 upgrade in `schema.test.ts` + `pnpm docs:check` |
| Review shots | **Not regenerated** this pass (no UI change) |
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
| Hardcoded ZEC/WBTC price-marks branches | **Yes** | `price-registry.ts` + `config/price-providers.json`. Tests in `pricing.test.ts`, `price-marks.test.ts` |
| Single HTTP source / silent static PROD fallback | **Yes** | Important assets `minSources=2`. Static skipped in PROD. Persist `ok=0` |
| Consensus without persisted rejects | **Yes** | Schema **v10** `kind=observation\|consensus` on `external_price_marks` (after v8 journal; v9 reserved for #23). Watchdog `/pricing/health`. v8 production DBs upgrade in `schema.test.ts` |
| ValuationService vs a second pricer | **Yes** | Store loads latest consensus only. Ranker `consumeIndexerValuation` fail-closes when reachable |
| Guardian quote with no providers | **Yes** | Scheduled as unconfigured; launch disabled until `/pricing/health` is ok |
| Docs / version | **Yes** | 0.3.3 patch on top of 0.3.2. `pnpm docs:check` |

## Still blocked (do not fake)

| Blocker | Why |
| --- | --- |
| Public mainnet (5042) | Hard blocked. No addresses. |
| Independent Codex / professional audit | Not performed. Do not claim audited. |
| Top-10 as onchain oracle | Frozen offchain by design. External USD marks are the same trust class. |
| Arc Factory claimed | No funded `ARC_TESTNET_PK` in this environment. |

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

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.
