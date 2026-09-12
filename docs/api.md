# API

Base URL: indexer (local `http://127.0.0.1:43148`).

> Official LP fee is **0**. Protocol charge is **350 bps**. The API will not invent 0.30% official pools. CI fails if this page and `ReactorConstants` disagree.

## Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/markets` | Keyset (`cursor_ts`,`cursor_token`) matches `sort`: `new`/`vol`/`price`. NUMERIC casts. Search/filter. `supply` = initial mint; `current_supply` tracks remaining `totalSupply()` (token burns + bounded reconcile, not ≡); `fdv_usd6` uses `current_supply`. |
| GET | `/markets/:token` | One market row (same SELECT as the board). 404 if unknown. |
| GET | `/page/token/:token` | Indexed aggregation: market + candles + swaps in one response (`interval`, `candle_limit`, `swap_limit`). SQL in parallel. Not a live quote. |
| GET | `/ticker/:ticker` | Canonical status, 24h lock, latest token |
| POST | `/quote` | **Operator policy gated** (recovered wallet proof + trusted geo) before any ticket / `tx` payload. `recipient` is rebound to the recovered signer. One `UserRouteQuoter` eth_call per candidate. Winner is `pickBest` (not max raw out). `feeLegs[]` are that winner + terminal market (`aggregateProtocolImpactBps` compounds). SELL includes `minQuoteOut` (first-leg quote) and `minOut` (final USDC). Protocol kinds use `exemptOfficialLegs[]`. JSON body **16KiB** default / **64KiB** hard max (stream + chunked). |
| GET | `/candles/:token` | `interval`, `limit`, exclusive `before`/`after` on `t`. Gap-fill ≤ `limit` (max 1000). Public read — not policy-gated. |
| GET | `/swaps/:token` | Bounded `limit`, `before_id` |
| GET | `/quote-assets` | Registered quotes |
| GET | `/valuation` | One ValuationService (nested multiply + ancestry). Consumes accepted consensus only. |
| GET | `/top10` | Canonical epoch candidates from ValuationService + persisted `current_supply`. Snapshot TTL 15m (`computedTs`); stale + failed refresh pauses. No per-request Factory RPC. |
| GET | `/pricing/health` | Per-asset consensus, accepted/rejected observations, Arc sanity from the verified `route_venues` executable mark (not a synthetic `markets` row). 503 in PROD when an important mark fails. |
| GET | `/stream` | SSE named events after persist commit. Clients patch cached board / token-page rows — do not refetch `/markets` on every print. `hello` includes `head` (hub id at attach) and `last` (resume cursor from `?after=` / `Last-Event-ID`). First-session toasts use `id > head`; reconnect must not raise that cutoff. `core` / `Top10Buy` rows carry `(chainId, tx, logIndex, eventKind)`. Accruals and `EpochSubmitted` (`top10`) are not buy+burn confirms. |
| GET | `/operator-policy/challenge` | Short-lived EIP-191 message + HMAC token for write-path wallet binding. Public. |
| GET | `/operator-policy/status` | **Official #65 decision read.** Same gate as writes. Optional `x-reactor-wallet-proof`. Minimized body: `ok`, `decision`, `reason`, `kind`, `error`, `disclaimer`, `policy`, `writesAllowed`, `source`. No wallet/IP/country/SDN. Public. |
| GET | `/health` | Liveness plus `sanctions` (active dataset version/hash, freshness SLA, refresh failures, operator + geo policy versions). |
| GET | `/sanctions/screen` | Exact official-list address lookup. `decision` is `blocked` / `clear` / `unavailable` plus `datasetVersion` / `freshness`. Not legal/OFAC compliance. Lookup only — write/authorization gating is [operator policy](/docs/operator-policy) (#62). |
| GET | `/sanctions/dataset` | Active dataset version, source coverage, and freshness. |
| GET | `/sanctions/health` | Same sanctions snapshot without chain lag. Stale/missing is never `clear`. |
| POST | `/upload` | **Operator policy gated** (recovered wallet proof + trusted geo) before the image is stored. Stream 2MB + sharp + SigV4 remote. Returns `uri` `/m/<id>.webp` (R2/S3 key `m/<id>.webp`) and `wallet` (recovered signer). |
| GET | `/m/:file` | Local WebP by filename (`<id>.webp`). CDN uses the same path as the object key. `nosniff` + `Content-Security-Policy: default-src 'none'; sandbox`. Public read — not policy-gated. |
| POST | `/launch/admit` | **Operator policy gated**, then ALLOW / CHALLENGE / DENY. Partner header `x-partner-key`. No signature. JSON body **16KiB** default / **64KiB** hard max. |
| POST | `/launch/authorize` | **Operator policy gated**, then admission → ALLOW receipt → isolated signer. CHALLENGE ≠ ALLOW. Policy deny is **403**; required-policy unavailable is **503** — no signature. JSON body **16KiB** default / **64KiB** hard max. |

## Launch signer (isolated process)

Binds `127.0.0.1`. Requires an ALLOW `AdmissionReceipt` (or internal token on loopback). Not generally callable. The same operator policy gate runs **before** any `LaunchAuthorization` output. Domain `verifyingContract` is the **TickerRegistry**. Full identity: factory, Factory V1, creator, quote, mode, ticker, name, metadata hash, `virtualQuote0`, curve, `authId`, deadline, chain. Receipt `launchConfigHash` must match. Durable Postgres/SQLite is required: store failure is `SIGNER_STORE_UNAVAILABLE` (503). Receipt consume + issuance bucket always run. `/health` is 503 when the store is down.

## Ops

`/ops` is not in public nav. Requires the ops token. The payload includes `sanctions` (exact dataset + policy versions). `POST /ops/sanctions/refresh` pulls official OFAC HTTPS sources through the #64 freshness layer (failure keeps last-known-good). `POST /ops/sanctions/writes` emergency-disables operated write assistance. `POST /ops/sanctions/review` queues an explicit operator review — user complaints are `NO_AUTOMATED_OVERRIDE`. See [Sanctions ops](/docs/sanctions-ops) and the [runbook](/docs/sanctions-runbook).

All JSON may include `request_id`. Rate limits apply to quote, upload, and pricing.

## Request-body limits

Public JSON POSTs (`/quote`, `/launch/admit`, `/launch/authorize`) share a stream cap: **default 16,384 bytes**, **hard maximum 65,536 bytes**. `JSON_BODY_LIMIT_BYTES` may lower or raise the default only up to the hard max — `1000000000` still enforces 64KiB. The cap is enforced on `Content-Length` **and** on chunked `Transfer-Encoding` with no declared length. The socket is destroyed as soon as the cap is exceeded — the process does not buffer an unbounded body. Oversize returns **413**. Invalid JSON returns **400**.

`POST /upload` stays on its own **2MB** image stream cap. The public Next BFF `POST /api/launch-pricing` applies the same default 16KiB / hard-max 64KiB JSON cap before proxying.

The isolated launch-pricing signer (`127.0.0.1:43149`) is not a public API; it uses the same JSON cap as defense in depth.

## Geo policy (not an HTTP route)

Issue **#63** adds `evaluateRequestGeo` on the indexer (trusted edge HMAC + versioned deny revision → ALLOW / DENY / UNKNOWN). It is **not** a public endpoint. HTTP write/authorization enforcement is [Operator policy](/docs/operator-policy). Browser country headers are ignored. See [Geo policy](/docs/geo-policy).

See [Markets](/docs/markets), [Quoting](/docs/quoting), [Admission](/docs/admission), [Operator policy](/docs/operator-policy).
