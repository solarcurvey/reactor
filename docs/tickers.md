# Ticker registry

> Global identity. Not owned by one factory. Survives Factory V1 / V2 / ….

See also the protocol note `TICKER_REGISTRY.md`.

## Canonical form

Shared by `Ticker.sol`, `@reactor/sdk`, the indexer, and the launch UI. Invalid input is **rejected**, not rewritten.

| Rule | Value |
| --- | --- |
| Alphabet | ASCII `A–Z` / `0–9` after uppercase fold |
| Length | 1–10 |
| Rejected | Unicode, whitespace, punctuation, confusables |

`zcat` → `ZCAT`. `zc at`, `ZC-AT`, `ZÇAT`, empty, and 11+ characters revert.

## Locks

| Event | Onchain effect |
| --- | --- |
| Successful launch | 24h **global** lock across quotes, factories, and modes |
| Failed / expired auth | **No squat.** Digest is not consumed. Ticker stays free. |
| `permanentlyLockTicker(ticker, token)` | Guardian-only, one-way. REACTOR-native token from an authorized factory with matching ticker. **not** an mcap oracle |
| `reserveTicker(ticker)` | Guardian-only reserved name (no token). Separate from launched-token locks. |

Reserved at genesis (permanent, no launch token): `CORE`, `REACTOR`, `USDC`, `ZEC`, `WBTC`, `EURC`.

After 24 hours the ticker may be used again unless Guardian permanently locked it. Two live tokens can share a ticker only after the lock expires — the UI and `GET /ticker/:ticker` show the latest claim.

## Lookups

- Contract: `TickerRegistry.status(ticker)` → canonical, record, `isAvailable`, reserved
- API: `GET /ticker/MOON`
- SDK: `client.ticker("moon")`

Factory version of the claiming factory is persisted on the token forever (`tokenFactoryVersion`). Deprecating a factory stops **new** launches only.
