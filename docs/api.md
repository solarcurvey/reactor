# API

Base URL: indexer (local `http://127.0.0.1:43148`).

> Official LP fee is **0**. Protocol charge is **350 bps**. The API will not invent 0.30% official pools. CI fails if this page and `ReactorConstants` disagree.

## Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/markets` | Keyset (`cursor_ts`,`cursor_token`) + NUMERIC sorts. Search/filter. |
| GET | `/ticker/:ticker` | Canonical status, 24h lock, latest token |
| POST | `/quote` | One `UserRouteQuoter` eth_call per candidate. Nested 3.5% legs listed separately. |
| GET | `/candles/:token` | `interval`, `limit`, `before`, `after`. Bounded. |
| GET | `/swaps/:token` | Bounded `limit`, `before_id` |
| GET | `/quote-assets` | Registered quotes |
| GET | `/valuation` | One ValuationService (nested multiply + ancestry) |
| GET | `/stream` | SSE |
| GET | `/health` | Liveness |
| POST | `/upload` | Stream 2MB + sharp + SigV4 remote. Returns `uri` `/m/<id>.webp` (R2/S3 key `m/<id>.webp`). |
| GET | `/m/:file` | Local WebP by filename (`<id>.webp`). CDN uses the same path as the object key. |
| POST | `/launch/admit` | ALLOW / CHALLENGE / DENY. Partner header `x-partner-key`. No signature. |
| POST | `/launch/authorize` | Public. Admission → ALLOW receipt → isolated signer. CHALLENGE ≠ ALLOW. |

## Launch signer (isolated process)

Binds `127.0.0.1`. Requires an ALLOW `AdmissionReceipt` (or internal token on loopback). Not generally callable. Domain `verifyingContract` is the **TickerRegistry**. Full identity: factory, Factory V1, creator, quote, mode, ticker, name, metadata hash, `virtualQuote0`, curve, `authId`, deadline, chain. Receipt `launchConfigHash` must match.

## Ops

`/ops` is not in public nav. Requires the ops token.

All JSON may include `request_id`. Rate limits apply to quote, upload, and pricing.

See [Markets](/docs/markets), [Quoting](/docs/quoting), [Admission](/docs/admission).
