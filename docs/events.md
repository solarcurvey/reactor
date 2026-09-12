# Events

Indexer watches Factory, InstantLaunchModule, hook, curve, vaults, PoolManager, TickerRegistry.

| Event | Effect |
| --- | --- |
| `TokenCreated` / `LaunchCreated` / `InstantLaunchCreated` | UPSERT token + bonding market |
| `LaunchAuthorized` | Persist ticker + Factory version |
| `TickerClaimed` / `TickerPermanentlyLocked` | Ticker board |
| `OfficialPoolCreated` / `GraduationCompleted` | Official pool UPSERT + `OFFICIAL_REACTOR_V4` venue |
| `CurveBuy` / `CurveSell` / `SwapFeeAccrued` / `Swap` | Trades + candles + 24h incremental roll |
| `RewardClaimed` / `SelfBurn*` / `Flywheel*` / `BuybackExecuted` / `COREBurned` | Side tables |

## Idempotence

Inserts treat **only** unique-constraint violations as duplicates:

- Postgres `23505`
- SQLite `UNIQUE constraint failed`

Any other error **aborts the tick**. The indexer does not swallow “looks like a retry” strings.

24h metrics: NUMERIC sums, latest price **by `ts`**, ValuationService USD, `volume_24h_usd6`. New trades increment; `rolled` marks expire out of the window.

## Atomic persist

`tick()` fetches logs, block timestamps, and the head hash **first** (RPC). Then **one** Store transaction writes every log-derived row in that range **and** advances `indexer_state` (`block` + `block_hash`). Mid-tick crash or a later write failure rolls **both** back. Reorg rewind of `block` + `block_hash` is the same (`rewindIndexerCursor`).

Postgres statement failures inside that transaction use a `SAVEPOINT` so a caught `23505` does not abort the batch. SQLite uses `BEGIN IMMEDIATE`. SSE publishes **after** commit. Full-market 24h roll and `populateExternalPriceMarks` run **after** commit (incremental rolls stay inside). Proof: `tick-atomic.test.ts` (SQLite + Postgres) and `pg-smoke.ts`.

See [Markets](/docs/markets). Auditor event list: `AUDIT_HANDOFF.md`.
