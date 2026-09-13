# Markets, candles, trades

> Indexer HTTP for the homepage board and trade tape. Not onchain truth.

## `GET /markets`

| Param | Meaning |
| --- | --- |
| `q` | Global search: symbol / name / ticker / token / quote symbol. Not a filter of the first loaded page. |
| `board` | Chip predicate: `new`, `trending` (live + `sort=vol`), `bonding`, `rewards`, `buy+burn`, `fair`, `usdc-quoted`. SQL in `parseBoard` / `listMarkets`. |
| `stage` | `bonding` or `v4` (also implied by some boards) |
| `quote` | Quote token address |
| `quote_symbol` | Quote ticker (e.g. `usdc`) |
| `featured` | `1` — closest-to-graduation bonding + highest 24h-vol row (not page-1) |
| `sort` | `new` (default), `vol`, `price` — **NUMERIC** casts, not INTEGER. Board may supply a hint. |
| `limit` | 1–100 (default 40) |
| `cursor_ts` + `cursor_token` | Keyset page. **`cursor_ts` is the sort key**, not always a timestamp: `new` → `updated_ts`, `vol` → `volume_24h_usd6`, `price` → `price_usd6`. Tie-break is `token` DESC. `next_cursor` repeats `{ cursor_ts, cursor_token }` for the last row using that same column. Not a frozen snapshot: a row inserted **ahead** of the cursor after page 1 will not appear on later pages; already-returned rows are not repeated; a row inserted **behind** the cursor may appear later. |
| `offset` | Legacy only when no cursor |

24h fields:

- `price_quote_x18` — **latest trade by `ts`**, not `MAX(price)`
- `price_usd6` / `fdv_usd6` / `volume_24h_usd6` / `liquidity_usd6` — ValuationService
- `liquidity_usd6` — quote-side USD (bonding `real_quote` or graduated `quote_lp`). Schema **v12**. Not FDV/5 and not a TVL claim.
- `change_24h_bps` — mark vs the latest trade at or before the 24h window. Empty string when unknown — clients must show `—`, not invented 0%.
- `fdv_usd6` — USD-6 **market cap / FDV** = mark × `tokens.current_supply`. That column **tracks** remaining onchain `totalSupply()` after `burn()`; it is **not** claimed identical at every instant. Do not use `tokens.supply` (TokenCreated mint).
- `current_supply` writers: token-level `Transfer` to zero and `Burned` via canonical `(chain_id, tx, log_index, event_kind)` (same-tx Transfer+Burned are two logs; `totalSupply()` reconcile corrects double count), plus a bounded reconcile that **also runs when the indexer is at head**. CORE, recently burned, and newly created tokens are prioritized. Protocol `SelfBurnExecuted` / `Top10Buy` / `COREBurned` are attribution only. `rollOneMarket` reads `current_supply`; it does not write it.
- `volume_24h_quote` — NUMERIC sum of notionals
- Incremental: new trades add; `rolled` marks expire out of the 24h window; `rollOneMarket` corrects

## `GET /markets/:token`

Same projected columns as the board for one checksummed address (stored lowercase). **404** when the row is missing. Clients must not walk `allTokens` to render a token page.

## `GET /page/token/:token`

One HTTP hop for the trading-first token page. The indexer `Promise.all`s `getMarket`, bounded candles, and the tape. Query: `interval` (default `5m`), `candle_limit` (default 300, max 1000), `swap_limit` (default 200, max 500). `sparse` is true when fewer than three real (`n>0`) candles exist.

This payload is **display** (chart + tape + board fields). It does not replace `POST /quote`. Marks can lag head; tickets stay 30s fail-closed.

## `GET /candles/:token`

`interval` (`1m|5m|15m|1h|4h|1d`), `limit` (default 300, max 1000), `before`, `after` (exclusive keyset on `t`, same as SQL `t < before` / `t > after`). Gap-fill is **bounded**: at most `limit` buckets (hard cap 1000). With `before`, the last filled bucket is the previous interval when `before` is bucket-aligned — fill will not synthesize a candle at exactly `before`. Historical `before` never extends to wall-clock now. Page N+1 (`before` = oldest `t` from page N) has no overlap. Missing buckets copy the last close (`n=0`, `v=0`).

## `GET /swaps/:token`

Bounded `limit` (default 200, max 500), `before_id` keyset.

## `GET /top10`

Canonical Top-10 epoch candidates. Ranked from graduated markets, persisted `current_supply` (no mint-supply fallback after schema v9), 12m VWAP, indexed `quote_lp` / `real_quote` liquidity, and ValuationService ancestry. Not a Factory RPC.

A persisted `current` snapshot is served only while `now − computedTs ≤ TOP10_SNAPSHOT_TTL_SEC` (15 minutes). Past that TTL the handler refreshes; a failed refresh returns `pauseEpoch` and empty rows — never the last healthy payload. Web `/api/reactor/top10` proxies this payload. Keeper uses the same TTL.

## Events

Inserts treat **only** Postgres `23505` / SQLite `UNIQUE constraint failed` as duplicates. Other errors abort the tick. Append-only rows use `(chain_id, tx, log_index, event_kind)` (shared journal + per-table) so two identical same-kind logs in one transaction both persist.

Each ingest tick persists log-derived writes — protocol events **and** token `Burned` / `Transfer` to zero — and the `indexer_state` cursor (`block`, `block_hash`) in **one** `BEGIN` / `BEGIN IMMEDIATE` transaction (`persistTickBatch`). A crash after some events but before the cursor — or after the cursor but before remaining events, including burn journal rows — cannot commit. RPC stays outside the transaction; SSE is after commit. See [Events](/docs/events).

Continue: [API](/docs/api) · [Valuation](/docs/valuation) · [Traders](/docs/traders).
