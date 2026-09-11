# API

Base URL: indexer (local `http://127.0.0.1:43148`).

Public: `/markets`, `/ticker/:ticker`, `/quote`, `/candles/:token`, `/swaps/:token`, `/quote-assets`, `/valuation`, `/stream`, `/health`, `/launch/admit`.

Ops (token): `/ops`.

All JSON responses may include `request_id`. Rate limits apply to quote, upload, and pricing.

Constants the API will not invent: official LP fee is 0; protocol charge is 350 bps. CI should fail if docs and `ReactorConstants` disagree.
