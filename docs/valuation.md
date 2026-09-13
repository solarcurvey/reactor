# ValuationService

> One service prices Top-10, the launch signer, and `/markets` USD columns. Not an onchain ZEC/USD oracle.

`packages/reactor/src/valuation.ts` → `ValuationService`. The indexer loads nodes from `quote_assets`, official `price_quote_x18`, and the latest **accepted consensus** row in `external_price_marks`. Individual HTTP prints never price the service.

## Rules

- Only `usdPegOne` assets are $1. EURC / Stablecoins category is not.
- Nested CAT → ZCAT → ZEC → USD must have a parent price or a live external mark. Never copy parent USD.
- Cycles throw. Depth > 3 fails closed (`MAX_VALUATION_DEPTH`).
- **PROD:** static marks are forbidden. The marks worker is data-driven (canonical token address, then symbol). Missing, stale, or disagreeing sources record `ok=0` and **do not** fall back to a hardcoded dollar.
- Signer calls `ValuationService.quoteUsd6` for every quote, including USDC (geometry still applies). A failed mark refuses `LaunchAuthorization`.
- **USD market cap / FDV** uses `tokens.current_supply` (**schema v9**, #23), which **tracks** remaining onchain `totalSupply()` (not the TokenCreated `tokens.supply` row). Writers: token-level `Transfer(to=0)` / `Burned` via `(chain_id, tx, log_index, event_kind)` in the same `persistTickBatch` transaction as the indexer cursor, plus bounded `totalSupply()` reconcile. Do not claim `current_supply` ≡ `totalSupply()` between reconciles. Protocol burn events are attribution, not a second subtraction. Reconcile can repair `current_supply`; it does not restore skipped journal rows. `GET /top10` ranks from the same persisted `current_supply` snapshot (not a live `totalSupply()` RPC during rank). Empty `current_supply` after schema v9 pauses the epoch — no fallback to TokenCreated `tokens.supply`. Liquidity for material-uncertainty is indexed `graduations.quote_lp` / `markets.real_quote`, not a synthetic fraction of last-good mark.

## Provider registry

`apps/indexer/config/price-providers.json` plus `PRICE_PROVIDERS_JSON` / `PRICE_PROVIDERS_PATH`. Each asset lists independent HTTP sources (`usd` / `usd6` / CoinGecko / Coinbase / Kraken parsers). Env slots `ZEC_HTTP_URL`, `ZEC_HTTP_URL_2`, `WBTC_HTTP_URL`, `WBTC_HTTP_URL_2` (or `*_HTTP_URLS`) fill those slots. Important production quotes default to **minSources = 2**.

Guardian-added external quotes are scheduled automatically from `quote_assets`. With no providers they persist `ok=0` / `no providers configured` and stay ineligible for new launches until configured. See [Guardian](/docs/guardian).

## Consensus thresholds

| Check | Default | Fail closed |
| --- | --- | --- |
| Staleness | 120s (`maxAgeSec`) | Observation rejected. Consensus fails if remaining sources are below `minSources`. |
| Deviation | 150 bps from median | Two-source disagreement fails. One outlier among ≥3 may be dropped if ≥2 inliers remain. |
| Arc venue sanity | 400 bps | Applied only when a verified `route_venues` / official pool vs USDC exists **and** an executable mark is actually obtained. Hookless external quote↔USDC venues persist that mark on the venue row (`last_price_quote_x18` or JSON `data.priceQuoteX18`), not on a synthetic REACTOR `markets` row. Official Instant Launch pairs may still use `markets.price_quote_x18` when `official_pools` has the pair. A verified edge with no mark skips the band rather than inventing a price. |
| Accepted mark freshness | 180s | ValuationService treats older consensus as `externalStale`. |

Accepted and rejected observations plus the `kind=consensus` row are persisted for `/pricing/health` and the watchdog. Schema **v10** adds `external_price_marks.kind` after #23 **v9** `current_supply` (real v9 DBs `ALTER` + backfill). `route_venues.last_price_quote_x18` is column-gated (no `schema_migrations` id). Schema **v11** is the Top-10 candidate snapshot (#33 / issue #10).

## Worker

Each indexer tick calls `populateExternalPriceMarks`. ValuationService reads **only** the latest consensus row per token. Trading continues when marks degrade; **new launch authorization** and **material Top-10 candidates** fail closed.

## Degradation

| Condition | Launch | Top-10 | Trading |
| --- | --- | --- | --- |
| Provider outage / stale / empty | Refuse authorization | Pause epoch if the candidate is material; skip dead low-value names | Continues |
| Source deviation / Arc sanity miss | Refuse authorization | Same material rule | Continues |
| Indexer `/valuation` reachable and `ok=false` | — | Ranker must not invent a second USD path | Charts may show unpriced |
| Indexer unreachable | Isolated signer uses the same registry (still no static in PROD) | LOCAL/offline fallbacks only | Lag |

This is **offchain trusted computation**, not an onchain ZEC/USD oracle. A compromised indexer can mis-mark USD; contracts still check Top-10 structure only.

## Instant `virtualQuote0`

The signer uses `virtualQuote0ForUsd(supply, quoteDecimals, quoteUsd6)` so a non-$1 quote still opens at **~$5k USD-equivalent**. USDC `usdPegOne` may use unsigned protocol geometry. See [Curve math](/docs/curve).

## Top-10

`GET /top10` is the official rank snapshot. It loads graduated markets from Postgres/SQLite, ranks on persisted `current_supply`, and values each quote through this service (including nested ancestry and accepted consensus marks). Serve and Keeper share `TOP10_SNAPSHOT_TTL_SEC`. `GET /valuation?token=` remains the per-asset USD probe.

The web app does **not** enumerate Factory tokens or invent a 0.30% quote/USDC pool. Keeper and `/api/reactor/top10` read the same persisted payload and refuse it when `pauseEpoch` or the snapshot is older than the TTL. A rejected mark is not replaced by a hookless pool hop. Contracts still check structure only — ranks are not a trustless oracle.

Continue: [Top-10](/docs/top-10) · [Markets](/docs/markets) · [Trust](/docs/trust).
