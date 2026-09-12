# For builders

Third-party terminals should use the public indexer + `@reactor/sdk`. Do not embed Keeper or Launch Signer keys.

## Packages

- `@reactor/sdk` — `ReactorClient` (markets, ticker, admit, authorize, SSE)
- `@reactor/core` — valuation, routes, prices, ticker normalize, admission helpers

Normalize tickers with `normalizeTicker` — same rules as `Ticker.sol`.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/markets` | SQL pagination, `q`, `stage`, `quote`, `sort`, `limit`, `offset` |
| GET | `/ticker/:ticker` | Lock / reserved / token |
| POST | `/launch/admit` | ALLOW / CHALLENGE / DENY (no signature) |
| POST | `/launch/authorize` | Admission then isolated sign. CHALLENGE ≠ ALLOW |
| POST | `/quote` | Exact RouteGraph edges; never invented 0.30% |
| GET | `/candles/:token` | Continuous OHLCV |
| GET | `/stream` | SSE |
| GET | `/health` | Lag + dialect |

Partner key: `x-partner-key`. Ops: `x-ops-token` (not on public nav).

## Events

Index both `OfficialPoolCreated` forms (factory: token/poolId/mode; hook: poolId/token/quote), `LaunchAuthorized`, `TickerClaimed`. Identity key for trades: `chainId + txHash + logIndex`.

## Deployments and versions

Protocol release is semver in `docs/version.json` (now **0.2.0**). Factory **V1** is immutable and is not that number. See [versioning](/docs/versioning) and [deployments](/docs/deployments).

Factory V1 deploys as two contracts: `ReactorFactory` + `InstantLaunchModule` (no proxy). Both must stay under EIP-170. See `pnpm size:guard` and `BUILD_REPORT.md`.

Production accepts **verified** Arc v4 addresses only — do not hardcode a PoolManager until it is verified on that chain. Mainnet (5042) is disabled. Never invent mainnet addresses.
