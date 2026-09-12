# Changelog

All **production** REACTOR protocol releases are listed here.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning: [Semantic Versioning](https://semver.org/) for the **protocol release**. Factory versions are separate and immutable.

- Protocol source of truth: `docs/version.json` (`protocolVersion`)
- Git tag: `vMAJOR.MINOR.PATCH` (see [Versioning](docs/versioning.md) and `CONTRIBUTING.md`)
- Factory **V1 stays V1 forever**. A new fee split or curve is Factory V2, not a protocol patch.

## [Unreleased]

API availability hardening. Tokenomics **unchanged**. Factory **V1**. No mainnet.

### Added / Changed

- Public JSON POSTs (`/quote`, `/launch/admit`, `/launch/authorize`) stream-cap request bodies at **16KiB** default / **64KiB** hard max (`JSON_BODY_LIMIT_BYTES`). Env cannot raise the cap past 64KiB. The cap applies to `Content-Length` and to chunked `Transfer-Encoding`. Oversize is **413**; the socket is destroyed so the process never buffers an unbounded JSON body.
- The public Next BFF `POST /api/launch-pricing` applies the same cap before proxying. The isolated signer uses the same reader as defense in depth.
- Regression tests cover Content-Length oversize, chunked oversize, slow chunked writes, and an absurd `JSON_BODY_LIMIT_BYTES` that still clamps to 64KiB.

## [0.3.2] - 2026-09-12

Postgres millisecond timestamps, media key/URL alignment, and signer fail-closed. Tokenomics **unchanged**. Factory **V1**.

### Security

- Isolated pricing signer **fail-closes** when the durable store cannot be opened. `openStore().catch(() => undefined)` is gone. Missing store is `SIGNER_STORE_UNAVAILABLE` (HTTP 503). Receipt consume and the signed-auth issuance bucket always run before any EIP-712 `LaunchAuthorization`. Health also requires the store.
- Regression: `pricing-signer-store.test.ts`.

### Added / Changed

- Schema **v6** promotes wall-clock millisecond / lease columns to `BIGINT`: `admission_hits.ts`, `issuance_bucket.updated_ms`, `leader_locks.ts`, `leader_locks.lease_until`, `keeper_operations.ts`, `alerts.ts`. Fresh Postgres DDL matches. Existing v5 databases `ALTER COLUMN … TYPE BIGINT` without data loss.
- Schema **v7** keys append-only event rows by `(chain_id, tx, log_index)`. Schema **v8** adds shared `indexer_event_journal` and per-table uniqueness on `(chain_id, tx, log_index, event_kind)` plus emitting `address`. Ingest `tick()` commits those rows and the `indexer_state` cursor in one transaction. Postgres savepoints `ROLLBACK TO` + `RELEASE`. SQLite + Postgres regressions in `tick-atomic.test.ts`.
- Real Postgres integration test (`pnpm --filter indexer test:pg`) inserts current `Date.now()` into admission, issuance bucket, leader lock, Keeper job, and alert paths; Keeper leadership and LaunchAuthorization issuance run against Postgres. CI job `postgres-ms-timestamps` runs that test on GitHub.
- Backend docs record seconds-vs-milliseconds conventions. SQLite INTEGER is already 64-bit; the production bug is Postgres 32-bit INTEGER overflow (~1.8e12 ms vs max 2_147_483_647).

### Fixed

- R2/S3 object keys match returned public media URLs: upload `m/<id>.webp`, not the bare content id. `MEDIA_CDN_BASE` + `/m/<id>.webp` resolves to the uploaded object. Mock SigV4 GET-after-PUT in `media-r2.test.ts`.
- Routed SELL `minQuoteOut` is the slipped first-leg quoteOut from the same selected `PreviewedRoute` / `splitPreviewRoute` terminal (6/8/18-dec quotes). Never launch-token `amountIn`. Preview failure returns no ticket.
- `GET /markets` keyset (`cursor_ts` + `cursor_token`) uses the same column as `sort`: `new` → `updated_ts`, `vol` → `volume_24h_usd6`, `price` → `price_usd6`. `sort=price` no longer pages on `updated_ts`.
- `GET /candles/:token` gap-fill materializes at most `limit` buckets (hard cap 1000). `before` / `after` stay exclusive on `t` (aligned `before` does not synthesize that bucket). A sparse 1m series does not allocate every minute from the first trade to now.
- Nested user quotes disclose **every** official REACTOR fee hop of the **scored winner** plus its terminal market, not only a single terminal leg and not an independently tracked max-`amountOut` preview. Two official 3.5% legs compound to **688 bps / 6.88%**. Protocol tickets use `exemptOfficialLegs[]`. Refs #5 (issue stays open).

### Tokenomics

- No change. Different split = new Factory version, not an edit to V1.

### Known limits (honest)

- Not audited. No public mainnet.
- Arc Factory **not claimed** unless `deployments/arc-factory-attempt.json` has a confirmed explorer hash.
- Top-10 ranks remain an offchain API.
- Factory V1 runtime must stay ≤ 23,552.

## [0.3.1] - 2026-09-12

Honest leftovers on 0.3.0. Tokenomics **unchanged**. Factory **V1**.

### Added / Changed

- Safe Transaction Builder JSON is generated from `deployments/local.json` (Batch A while paused → VerifyGenesis → Batch B T0) plus MultiSend packing. Local deployer ≠ Guardian Safe. Not an empty template.
- `UserRouteQuoter` indexer `eth_call` uses ERC-20 state overrides so nested quotes do not need intermediate wallet balances. Executor fallback is documented only when the quoter is undeployed.
- Production hard gates: non-LOCAL / `NODE_ENV=production` refuses start and launch if Turnstile secret/site key is missing, if `SIGNER_INLINE` would run, or if the Anvil `#0` signer fallback would be used. LOCAL may keep bypasses.
- Funding-parent heuristic: bounded USDC `Transfer` lookback + rename. Not chain analysis.
- `sharp` is an explicit required dependency (`pnpm.onlyBuiltDependencies`). Document `pnpm approve-builds`. Startup asserts the native pipeline.
- Arc Public Testnet: no key in this environment — `deployments/arc-testnet-blocker.md` + `scripts/arc-testnet-checklist.md`. `claimed: false`.
- Arc-compatible native gas metadata is USDC-18 (not ETH). `CoreToken` is the name; `TestCORE` remains a deprecated alias. `registerNative` stays fail-loud.
- Indexer ingest: log-derived writes and `indexer_state` cursor (`block`, `block_hash`) commit in one transaction. Mid-tick crash rolls both back. Postgres statement savepoints `ROLLBACK TO` + `RELEASE`. Append-only rows use canonical `(chain_id, tx, log_index)` (not tx+amount / tx+kind). SSE after commit. SQLite + Postgres regressions in `tick-atomic.test.ts`.

### Tokenomics

- No change. Different split = new Factory version, not an edit to V1.

### Known limits (honest)

- Not audited. No public mainnet.
- Arc Factory **not claimed** unless `deployments/arc-factory-attempt.json` has a confirmed explorer hash.
- Top-10 ranks remain an offchain API.
- Funding-parent is a heuristic, not chain analysis.
- Factory V1 runtime must stay ≤ 23,552.

## [0.3.0] - 2026-09-12

Correctness pass on admission, quoting, indexer markets, valuation, media, Arc. Tokenomics **unchanged**. Factory **V1**.

### Added / Changed

- Launch page uses the real Cloudflare Turnstile widget. CHALLENGE → widget → token → re-admit → ALLOW → signer. No `window.turnstileToken` stub.
- ELEVATED/ATTACK: a solved challenge ALLOWs under rate + issuance limits. Table-driven tests. No infinite CHALLENGE loop.
- Global LaunchAuthorization issuance is an atomic token-bucket (Postgres/SQLite, optional Redis). Counts **signed** auths.
- ALLOW receipts carry `launchConfigHash`; the signer requires a match.
- Receipt consume is `UPDATE…RETURNING` / SQLite transaction. Concurrent consume test.
- Funding-cluster is an honest network-rename + optional first-USDC-funder signal. No KYC.
- Fair LaunchAuthorization binds supply/decimals/duration/auctionBps/minRaise via `fairCurveConfig`. Instant keeps `INSTANT_CURVE_V1`.
- `permanentlyLockTicker` reverts if another token holds the active 24h lock.
- `UserRouteQuoter`: one eth_call whole-route preview. Edge kinds preserved. Multi-candidate by real `amountOut`. Nested fee legs disclosed. Maintenance quoter stays separate. Never minOut 0/1.
- Indexer: real Store transactions; only 23505/UNIQUE as duplicate; 24h NUMERIC + latest-by-ts + ValuationService USD + incremental roll; bounded candles/trades; keyset pagination; NUMERIC sorts.
- One ValuationService for Top-10 / signer / markets. `external_price_marks` worker. No static ZEC in PROD.
- Media: explicit `sharp`, stream 2MB cap, R2/S3 SigV4.
- Safe Transaction Builder JSON template + deployer≠Guardian. `registerNative` no longer silent.
- Arc: USDC 18 gas / 6 ERC20 documented. Finality default 0 (BFT, drop eth-8). Real broadcast if `ARC_TESTNET_PK`, else honest blocker.
- Docs corpus expanded (quoting, valuation, markets, media, Arc). Package versions aligned to 0.3.0.

### Tokenomics

- No change. Different split = new Factory version, not an edit to V1.

### Known limits (honest)

- Not audited. No public mainnet.
- Arc Factory **not claimed** unless `deployments/arc-factory-attempt.json` has a confirmed explorer hash.
- Top-10 ranks remain an offchain API.
- LOCAL Turnstile bypass when secret unset.
- Funding-cluster is a heuristic, not chain analysis.
- Factory V1 runtime must stay ≤ 23,552. Logic stays in modules/libs/backend.

## [0.2.0] - 2026-09-12

Material platform correctness pass. Tokenomics **unchanged**: official 3.5% quote-side charge (2% holders / 1% Top-10 / 0.5% CORE), 1B / 18 supply, Dev Buy ≤5% token-out, 24h global ticker lock. Factory **V1**.

### Added / Changed

- Launch admission is mandatory before any `LaunchAuthorization`. Public `POST /launch/authorize` → admission → ALLOW receipt → isolated signer. CHALLENGE ≠ ALLOW. Direct signer bypass fails.
- Durable anti-spam in Postgres/SQLite (rates, challenges, image hashes, issuance, receipts). Wired Turnstile validate.
- EIP-712 binds full immutable identity: factory, Factory version, creator, quote, mode, ticker, name, metadata hash, virtualQuote0, curve, authId, deadline, chain. Metadata frozen at launch.
- `permanentlyLockTicker` requires a REACTOR-native authorized-factory token with matching ticker. Reserved names are separate (`reserveTicker`).
- Quote simulates exact RouteGraph edges (`OFFICIAL_REACTOR_V4` / `EXTERNAL_V4_HOOKLESS` / `BONDING_CURVE`). Multi-candidate ≤3 hops. Sim fail → unavailable. Never `minOut` 0/1.
- Indexer: rich `OfficialPoolCreated` UPSERT, real 24h aggregations, Arc finality confirmation depth.
- Keeper: single lease leadership (not mixed with advisory lock). No silent static ZEC in prod. R2/S3 fail-closed in prod.
- Factory V1 EIP-170 split: `InstantLaunchModule` (no proxy) creates tokens, verifies EIP-712, opens official fair pools. Factory runtime 23,280 ≤ 23,552 CI gate.
- Docs corpus: How REACTOR Works, trust top-10, Guardian/Keeper matrix, admission, routes, examples. Protocol **0.2.0**.
- UI: `/search`, ticker+challenge launch path, Lightweight Charts, tape, contextual docs, private Ops.

### Tokenomics

- No change. Different split = new Factory version, not an edit to V1.

### Known limits (honest)

- Not audited. No public mainnet. Arc Public Testnet deploy of Factory is attempted and recorded in `BUILD_REPORT.md` — do not claim success without an explorer tx.
- Top-10 ranks remain an offchain API (trust assumption #1).
- Factory V1 is split: `InstantLaunchModule` holds `new ReactorToken`, EIP-712 verify, and official-pool open. Runtime is under EIP-170 with a 1,024-byte CI margin (`pnpm size:guard`). Arc Public Testnet create is attempted and recorded — do not claim success without an explorer tx.

## [0.1.0] - 2026-09-11

First explicit protocol semver. Pre-audit. **Local Anvil / testnet docs only. Not mainnet.**  
Git tag: `v0.1.0`. Factory: **V1** (`FACTORY_VERSION = 1`).
