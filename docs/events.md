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

Store work uses real transactions (`BEGIN` / `BEGIN IMMEDIATE`). See [Markets](/docs/markets). Auditor event list: `AUDIT_HANDOFF.md`.
