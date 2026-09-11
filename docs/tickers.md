# Ticker registry

See also the protocol note [`TICKER_REGISTRY.md`](https://github.com).

Global `TickerRegistry` survives factory versions. Normalize is shared (Solidity / TypeScript). Successful launch → 24h global lock. Failed auth does not squat. Guardian `permanentlyLockTicker` is one-way and **not** an mcap oracle.

Reserved: CORE, REACTOR, USDC, ZEC, WBTC, EURC.

`GET /ticker/MOON` returns availability, lock, and the latest token if any.
