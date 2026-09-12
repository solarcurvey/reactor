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
| `cursor_ts` + `cursor_token` | Keyset page. `next_cursor` on the response |
| `offset` | Legacy only when no cursor |

24h fields:

- `price_quote_x18` — **latest trade by `ts`**, not `MAX(price)`
- `price_usd6` / `fdv_usd6` / `volume_24h_usd6` — ValuationService
- `volume_24h_quote` — NUMERIC sum of notionals
- Incremental: new trades add; `rolled` marks expire out of the 24h window; `rollOneMarket` corrects

## `GET /candles/:token`

`interval` (`1m|5m|15m|1h|4h|1d`), `limit` (default 300, max 1000), `before`, `after` (keyset on `t`). Bounded. Gap-filled.

## `GET /swaps/:token`

Bounded `limit` (default 200, max 500), `before_id` keyset.

## Events

Inserts treat **only** Postgres `23505` / SQLite `UNIQUE constraint failed` as duplicates. Other errors abort the tick. Store work uses real transactions (`BEGIN IMMEDIATE` / `BEGIN`).
