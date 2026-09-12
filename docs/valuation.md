# ValuationService

One service prices Top-10, the launch signer, and `/markets` USD columns.

`packages/reactor/src/valuation.ts` → `ValuationService`. The indexer loads nodes from `quote_assets`, official `price_quote_x18`, and the latest **accepted consensus** row in `external_price_marks`. Individual HTTP prints never price the service.

## Rules

- Only `usdPegOne` assets are $1. EURC / Stablecoins category is not.
- Nested CAT → ZCAT → ZEC → USD must have a parent price or a live external mark. Never copy parent USD.
- Cycles throw. Depth > 3 fails closed.
- **PROD:** static marks are forbidden. The marks worker is data-driven (canonical token address, then symbol). Missing, stale, or disagreeing sources record `ok=0` and **do not** fall back to a hardcoded dollar.
- Signer calls `ValuationService.quoteUsd6` for every quote, including USDC (geometry still applies). A failed mark refuses `LaunchAuthorization`.

## Provider registry

`apps/indexer/config/price-providers.json` plus `PRICE_PROVIDERS_JSON` / `PRICE_PROVIDERS_PATH`. Each asset lists independent HTTP sources (`usd` / `usd6` / CoinGecko / Coinbase / Kraken parsers). Env slots `ZEC_HTTP_URL`, `ZEC_HTTP_URL_2`, `WBTC_HTTP_URL`, `WBTC_HTTP_URL_2` (or `*_HTTP_URLS`) fill those slots. Important production quotes default to **minSources = 2**.

Guardian-added external quotes are scheduled automatically from `quote_assets`. With no providers they persist `ok=0` / `no providers configured` and stay ineligible for new launches until configured. See [Guardian](/docs/guardian).

## Consensus thresholds

| Check | Default | Fail closed |
| --- | --- | --- |
| Staleness | 120s (`maxAgeSec`) | Observation rejected. Consensus fails if remaining &lt; `minSources`. |
| Deviation | 150 bps from median | Two-source disagreement fails. One outlier among ≥3 may be dropped if ≥2 inliers remain. |
| Arc venue sanity | 400 bps | Applied only when a verified `route_venues` / official pool vs USDC exists and has an executable mark. |
| Accepted mark freshness | 180s | ValuationService treats older consensus as `externalStale`. |

Accepted and rejected observations plus the `kind=consensus` row are persisted for `/pricing/health` and the watchdog. Schema **v10** adds `external_price_marks.kind` (real post-#27 v8 DBs `ALTER` + backfill; v9 reserved for #23 `current_supply`).

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

## Top-10

`GET /valuation?token=` is the USD source the web ranker consumes when reachable. A rejected mark is not replaced by a hookless pool hop. Local fallbacks remain for offline tests. Contracts still check structure only — ranks are not a trustless oracle.
