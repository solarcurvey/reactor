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
| POST | `/launch/admit` | ALLOW / CHALLENGE / DENY. Partner header `x-partner-key` |

## Launch signer (isolated process)

`POST /launch/authorize` on the signer (`:43149`), proxied by the web app. Signs `LaunchAuthorization` for **every** quote, including USDC. Domain `verifyingContract` is the **TickerRegistry**.

## Ops

`/ops` is not in public nav. Requires the ops token.

All JSON may include `request_id`. Rate limits apply to quote, upload, and pricing.
