# Markets, candles, trades

Indexer HTTP for the homepage board and trade tape.

## `GET /markets`

| Param | Meaning |
| --- | --- |
| `q` | Search symbol / name / ticker / token |
| `stage` | `bonding` or `v4` |
| `quote` | Quote token |
| `sort` | `new` (default), `vol`, `price` — **NUMERIC** casts, not INTEGER |
| `limit` | 1–100 (default 40) |
| `cursor_ts` + `cursor_token` | Keyset page. **`cursor_ts` is the sort key**, not always a timestamp: `new` → `updated_ts`, `vol` → `volume_24h_usd6`, `price` → `price_usd6`. Tie-break is `token` DESC. `next_cursor` repeats `{ cursor_ts, cursor_token }` for the last row using that same column. |
| `offset` | Legacy only when no cursor |

24h fields:

- `price_quote_x18` — **latest trade by `ts`**, not `MAX(price)`
- `price_usd6` / `fdv_usd6` / `volume_24h_usd6` — ValuationService
- `volume_24h_quote` — NUMERIC sum of notionals
- Incremental: new trades add; `rolled` marks expire out of the 24h window; `rollOneMarket` corrects

## `GET /candles/:token`

`interval` (`1m|5m|15m|1h|4h|1d`), `limit` (default 300, max 1000), `before`, `after` (keyset on `t`). Gap-fill is **bounded**: the handler materializes at most `limit` buckets (hard cap 1000) in the most recent window ending at `before` or now. A sparse 1m series does not allocate every minute from the first trade to now. Missing buckets copy the last close (`n=0`, `v=0`).

## `GET /swaps/:token`

Bounded `limit` (default 200, max 500), `before_id` keyset.

## Events

Inserts treat **only** Postgres `23505` / SQLite `UNIQUE constraint failed` as duplicates. Other errors abort the tick. Append-only rows use `(chain_id, tx, log_index, event_kind)` (shared journal + per-table) so two identical same-kind logs in one transaction both persist.

Each ingest tick persists log-derived writes and the `indexer_state` cursor (`block`, `block_hash`) in **one** `BEGIN` / `BEGIN IMMEDIATE` transaction (`persistTickBatch`). A crash after some events but before the cursor — or after the cursor but before remaining events — cannot commit. RPC stays outside the transaction; SSE is after commit. See [Events](/docs/events).
