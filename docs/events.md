# Events

Indexer watches Factory, InstantLaunchModule, hook, curve, vaults, PoolManager, TickerRegistry. Token / CORE addresses are watched separately for `Burned` and `Transfer` (only `to == address(0)` counts as a burn).

| Event | Effect |
| --- | --- |
| `TokenCreated` / `LaunchCreated` / `InstantLaunchCreated` | UPSERT token + bonding market |
| `LaunchAuthorized` | Persist ticker + Factory version |
| `TickerClaimed` / `TickerPermanentlyLocked` | Ticker board |
| `OfficialPoolCreated` / `GraduationCompleted` | Official pool UPSERT + `OFFICIAL_REACTOR_V4` venue |
| `CurveBuy` / `CurveSell` / `SwapFeeAccrued` / `Swap` | Trades + candles + 24h incremental roll |
| `RewardClaimed` / `SelfBurn*` / `Top10Buy` / `Flywheel*` / `BuybackExecuted` / `COREBurned` | Attribution side tables. They do **not** subtract supply a second time |
| `Burned` / `Transfer` to zero | Public `burn()`. Fetched **after** `TokenCreated` upserts. Canonical `(chain_id, tx, log_index, event_kind)` — Transfer and Burned are two logs |
| Tick `totalSupply()` | Bounded reconcile even when at head (CORE + recently burned + newly created + rotating page). Corrects missed / same-tx burns. `current_supply` tracks this; not a live ≡ |

## Idempotence

Append-only event rows (trades, claims, selfburn, flywheel, core buybacks, reward/guardian events) are keyed by **canonical log identity** `(chain_id, tx, log_index, event_kind)` plus emitting `address` on the shared `indexer_event_journal` — not `(chain_id, tx, log_index)` alone, and not `(tx, token, amount)` or `(tx, quote, kind)`. Side tables carry the same unique tuple (real `logIndex` + `chainId` + Solidity event name). Two same-kind events in one transaction at different log indexes both persist. Two different kinds at the same log index both persist. Replay of those exact logs is `ON CONFLICT DO NOTHING`. Different `chain_id` values do not collide.

Inserts treat **only** unique-constraint violations as duplicates:

- Postgres `23505`
- SQLite `UNIQUE constraint failed`

Any other error **aborts the tick**. The indexer does not swallow “looks like a retry” strings.

24h metrics: NUMERIC sums, latest price **by `ts`**, ValuationService USD, `volume_24h_usd6`. New trades increment; `rolled` marks expire out of the window.

## Atomic persist

`tick()` fetches logs, block timestamps, and the head hash **first** (RPC). Then **one** Store transaction writes every log-derived row in that range **and** advances `indexer_state` (`block` + `block_hash`). Mid-tick crash or a later write failure rolls **both** back. Reorg rewind of `block` + `block_hash` is the same (`rewindIndexerCursor`).

Postgres statement failures inside that transaction use a `SAVEPOINT`; on failure the savepoint is `ROLLBACK TO` **and** `RELEASE` so caught `23505` does not accumulate nested savepoint state. Prefer `ON CONFLICT DO NOTHING` on the log identity. SQLite uses `BEGIN IMMEDIATE`. SSE publishes **after** commit. Full-market 24h roll and `populateExternalPriceMarks` run **after** commit (incremental rolls stay inside). Proof: `tick-atomic.test.ts` (SQLite + Postgres) and `pg-smoke.ts`.

See [Markets](/docs/markets). Auditor event list: `AUDIT_HANDOFF.md`.
