# API

Base URL: indexer (local `http://127.0.0.1:43148`).

> Official LP fee is **0**. Protocol charge is **350 bps**. The API will not invent 0.30% official pools. CI fails if this page and `ReactorConstants` disagree.

## Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/markets` | SQL pagination, search, sort. Not `SELECT *` then page. |
| GET | `/ticker/:ticker` | Canonical status, 24h lock, latest token |
| POST | `/quote` | Nested official 3.5% legs listed separately |
| GET | `/candles/:token` | Continuous OHLCV |
| GET | `/swaps/:token` | Trade tape |
| GET | `/quote-assets` | Registered quotes |
| GET | `/valuation` | One ValuationService (nested multiply + ancestry) |
| GET | `/stream` | SSE |
| GET | `/health` | Liveness |
| POST | `/launch/admit` | ALLOW / CHALLENGE / DENY. Partner header `x-partner-key`. No signature. |
| POST | `/launch/authorize` | Public. Admission → ALLOW receipt → isolated signer. CHALLENGE ≠ ALLOW. |

## Launch signer (isolated process)

Binds `127.0.0.1`. Requires an ALLOW `AdmissionReceipt` (or internal token on loopback). Not generally callable. Domain `verifyingContract` is the **TickerRegistry**. Full identity: factory, Factory V1, creator, quote, mode, ticker, name, metadata hash, `virtualQuote0`, curve, `authId`, deadline, chain.

## Ops

`/ops` is not in public nav. Requires the ops token.

All JSON may include `request_id`. Rate limits apply to quote, upload, and pricing.
