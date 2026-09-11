# Ticker Registry

Global launch identity. **Not** inside one factory. Survives Factory V1 / V2 / ….

## Canonical form

Shared by contracts (`Ticker.sol`), `@reactor/sdk`, the indexer, and the launch UI:

- Uppercase ASCII `A–Z` / `0–9` only
- Length 1–10
- No Unicode, whitespace, punctuation, or confusable mapping

Invalid input is **rejected**, not rewritten.

## Locks

| Event | Onchain effect |
| --- | --- |
| Successful launch | 24h **global** lock of that ticker across quotes, factories, and modes |
| Failed / expired auth | **No squat.** Digest is not consumed. Ticker stays free. |
| `permanentlyLockTicker(ticker, canonicalToken)` | Guardian-only, one-way. Qualitative judgment — **not** an mcap oracle |

Reserved at genesis (permanent, no launch token): `CORE`, `REACTOR`, `USDC`, `ZEC`, `WBTC`, `EURC`.

## Lookups

- Contract: `TickerRegistry.status(ticker)`
- API: `GET /ticker/:ticker`
- SDK: `client.ticker("moon")`
