# API

Base URL: indexer (local `http://127.0.0.1:43148`).

> Official LP fee is **0**. Protocol charge is **350 bps**. The API will not invent 0.30% official pools. CI fails if this page and `ReactorConstants` disagree.

## Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/markets` | Keyset (`cursor_ts`,`cursor_token`) matches `sort`: `new`/`vol`/`price`. NUMERIC casts. Search/filter. |
| GET | `/ticker/:ticker` | Canonical status, 24h lock, latest token |
| POST | `/quote` | One `UserRouteQuoter` eth_call per candidate. Ticket hops / `amountOut` / `minOut`s / terminal market-leg are atomic to the selected candidate (`PreviewRoute` is `hops+1`). SELL includes `minQuoteOut` (first-leg quote) and `minOut` (final USDC). Nested 3.5% legs listed separately. JSON body **16KiB** (stream + chunked). |
| GET | `/candles/:token` | `interval`, `limit`, exclusive `before`/`after` on `t`. Gap-fill ≤ `limit` (max 1000). |
| GET | `/swaps/:token` | Bounded `limit`, `before_id` |
| GET | `/quote-assets` | Registered quotes |
| GET | `/valuation` | One ValuationService (nested multiply + ancestry) |
| GET | `/stream` | SSE |
| GET | `/health` | Liveness |
| POST | `/upload` | Stream 2MB + sharp + SigV4 remote. Returns `uri` `/m/<id>.webp` (R2/S3 key `m/<id>.webp`). |
| GET | `/m/:file` | Local WebP by filename (`<id>.webp`). CDN uses the same path as the object key. |
| POST | `/launch/admit` | ALLOW / CHALLENGE / DENY. Partner header `x-partner-key`. No signature. JSON body **16KiB**. |
| POST | `/launch/authorize` | Public. Admission → ALLOW receipt → isolated signer. CHALLENGE ≠ ALLOW. JSON body **16KiB**. |

## Launch signer (isolated process)

Binds `127.0.0.1`. Requires an ALLOW `AdmissionReceipt` (or internal token on loopback). Not generally callable. Domain `verifyingContract` is the **TickerRegistry**. Full identity: factory, Factory V1, creator, quote, mode, ticker, name, metadata hash, `virtualQuote0`, curve, `authId`, deadline, chain. Receipt `launchConfigHash` must match. Durable Postgres/SQLite is required: store failure is `SIGNER_STORE_UNAVAILABLE` (503). Receipt consume + issuance bucket always run. `/health` is 503 when the store is down.

## Ops

`/ops` is not in public nav. Requires the ops token.

All JSON may include `request_id`. Rate limits apply to quote, upload, and pricing.

## Request-body limits

Public JSON POSTs (`/quote`, `/launch/admit`, `/launch/authorize`) share a stream cap: **default 16,384 bytes**, **hard maximum 65,536 bytes**. `JSON_BODY_LIMIT_BYTES` may lower or raise the default only up to the hard max — `1000000000` still enforces 64KiB. The cap is enforced on `Content-Length` **and** on chunked `Transfer-Encoding` with no declared length. The socket is destroyed as soon as the cap is exceeded — the process does not buffer an unbounded body. Oversize returns **413**. Invalid JSON returns **400**.

`POST /upload` stays on its own **2MB** image stream cap. The public Next BFF `POST /api/launch-pricing` applies the same default 16KiB / hard-max 64KiB JSON cap before proxying.

The isolated launch-pricing signer (`127.0.0.1:43149`) is not a public API; it uses the same JSON cap as defense in depth.

See [Markets](/docs/markets), [Quoting](/docs/quoting), [Admission](/docs/admission).
