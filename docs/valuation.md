# ValuationService

One service prices Top-10, the launch signer, and `/markets` USD columns.

`packages/reactor/src/valuation.ts` → `ValuationService`. The indexer loads nodes from `quote_assets`, official `price_quote_x18`, and `external_price_marks`.

## Rules

- Only `usdPegOne` assets are $1. EURC / Stablecoins category is not.
- Nested CAT → ZCAT → ZEC → USD must have a parent price or a live external mark. Never copy parent USD.
- Cycles throw. Depth > 3 fails closed.
- **PROD:** static ZEC is forbidden. Set `ZEC_HTTP_URL`. The marks worker writes `external_price_marks`; missing URL records `ok=0`.
- Signer calls `ValuationService.quoteUsd6` for every quote, including USDC (geometry still applies).
- **USD market cap / FDV** uses `tokens.current_supply`, which **tracks** remaining onchain `totalSupply()` (not the TokenCreated `tokens.supply` row). Writers: token-level `Transfer(to=0)` / `Burned` via `(chain_id, tx, log_index, event_kind)` in the same `persistTickBatch` transaction as the indexer cursor, plus bounded `totalSupply()` reconcile. Do not claim `current_supply` ≡ `totalSupply()` between reconciles. Protocol burn events are attribution, not a second subtraction. Reconcile can repair `current_supply`; it does not restore skipped journal rows. `GET /top10` ranks from the same persisted `current_supply` snapshot (not a live `totalSupply()` RPC during rank).

## Worker

Each indexer tick calls `populateExternalPriceMarks`. Latest mark per token (by `id`) is fused into the service. Stale marks (>180s) are `externalStale`.

## Top-10

`GET /top10` is the official rank snapshot. It loads graduated markets from Postgres/SQLite, ranks on persisted `current_supply`, and values each quote through this service (including nested ancestry). `GET /valuation?token=` remains the per-asset USD probe. Contracts still check structure only — ranks are not a trustless oracle.
