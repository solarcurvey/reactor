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
| `Burned` / `Transfer` to zero | Public `burn()`. RPC fetch uses already-indexed tokens plus `TokenCreated` addresses from this window (same-window `burn()` is not missed). Writes share the `persistTickBatch` transaction with the cursor. Canonical `(chain_id, tx, log_index, event_kind)` — Transfer and Burned are two logs |
| Tick `totalSupply()` | Bounded reconcile even when at head (CORE + recently burned + newly created + rotating page). Corrects missed / same-tx burns. `current_supply` tracks this; not a live ≡ |

## Idempotence

Append-only event rows (trades, claims, selfburn, flywheel, core buybacks, reward/guardian events) are keyed by **canonical log identity** `(chain_id, tx, log_index, event_kind)` plus emitting `address` on the shared `indexer_event_journal` — not `(chain_id, tx, log_index)` alone, and not `(tx, token, amount)` or `(tx, quote, kind)`. Side tables carry the same unique tuple (real `logIndex` + `chainId` + Solidity event name). Two same-kind events in one transaction at different log indexes both persist. Two different kinds at the same log index both persist. Replay of those exact logs is `ON CONFLICT DO NOTHING`. Different `chain_id` values do not collide.

Inserts treat **only** unique-constraint violations as duplicates:

- Postgres `23505`
- SQLite `UNIQUE constraint failed`

Any other error **aborts the tick**. The indexer does not swallow “looks like a retry” strings.

24h metrics: NUMERIC sums, latest price **by `ts`**, ValuationService USD, `volume_24h_usd6`. New trades increment; `rolled` marks expire out of the window.

## Atomic persist

`tick()` fetches protocol logs **and** token `Burned` / `Transfer` to zero, block timestamps, and the head hash **first** (RPC). Then **one** Store transaction writes every log-derived row in that range — including burn journal / `current_supply` writes — **and** advances `indexer_state` (`block` + `block_hash`). There is no second transaction after the cursor. Mid-tick crash or a later write failure rolls **both** back. Restart from `cursor + 1` cannot skip those burn rows. Reorg rewind of `block` + `block_hash` is the same (`rewindIndexerCursor`).

Postgres statement failures inside that transaction use a `SAVEPOINT`; on failure the savepoint is `ROLLBACK TO` **and** `RELEASE` so caught `23505` does not accumulate nested savepoint state. Prefer `ON CONFLICT DO NOTHING` on the log identity. SQLite uses `BEGIN IMMEDIATE`. SSE publishes **after** commit. Full-market 24h roll and `populateExternalPriceMarks` run **after** commit (incremental rolls stay inside). Proof: `tick-atomic.test.ts` (SQLite + Postgres) and `pg-smoke.ts`.

## Live UI (confirmed only)

`GET /stream` fans out **after** that commit. The first event is `hello` with `last` (resume cursor) and `head` (hub id at attach). A first-session client toasts only `id > hello.head`. Reconnect uses `?after=<lastSseId>` and/or `Last-Event-ID`; the UI **does not** raise the first-session cutoff (that would drop events that landed while disconnected). Replay of ids `<=` that cutoff is still suppressed.

Dedupe is canonical log identity `(chainId, txHash, logIndex, eventKind)` on the SSE row. The module `seen` set outlives the visible toast array (auto-dismiss, stack cap, remount), so a replay of the same log cannot re-toast. Two `Top10Buy` logs in one tx at different `logIndex` values are two notices. The visible stack is a display window only.

The web app shows **bottom-right** toasts only for:

| SSE | Onchain | Toast |
| --- | --- | --- |
| `core` | `BuybackExecuted` / `COREBurned` | CORE buy+burn confirmed (per log identity) |
| `burn` + `eventKind=Top10Buy` | `Top10Buy` | Top-10 buy+burn confirmed (per log identity) |

No toast for pending wallet txs, `SelfBurnAccrued` / `SelfBurnExecuted`, holder `Burned`, or `EpochSubmitted`. Hover/focus pauses auto-dismiss. The stack uses `safe-area-inset-*`. `prefers-reduced-motion: reduce` disables the enter animation. Amounts on those SSE rows are attribution (`quoteIn` / `coreOut` / `usdcIn` / `burned`), not a second supply subtract.

Issue **#38 stays open** until merge and post-merge verify. The visible CI/release gate is `.github/workflows/live-toasts.yml` job **`live-toasts-ui`**: identity unit tests plus Playwright regressions for duplicate-after-dismiss, same-tx multi-log, disconnect/reconnect, safe-area, and reduced-motion (`pnpm test:live-toasts`).

See [Traders](/docs/traders), [CORE](/docs/core), [Top-10](/docs/top-10).

See [Markets](/docs/markets). Auditor event list: `AUDIT_HANDOFF.md`.
