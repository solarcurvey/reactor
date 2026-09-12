# Launch admission

> Protocol **0.2.0**. CHALLENGE ≠ ALLOW.

`POST /launch/authorize` is the public path.

1. **Admission** — ticker, reserved list, factory, quote, metadata, Turnstile, wallet/session/IP/ASN/client rates, image-hash cluster, funding-cluster, global `NORMAL` / `ELEVATED` / `ATTACK`.
2. **ALLOW** issues a short-lived HMAC `AdmissionReceipt`.
3. **Pricing** is computed only after ALLOW.
4. **Isolated signer** accepts the receipt (or an internal token on loopback). It is **not** generally callable.
5. EIP-712 binds creator, factory, Factory version, ticker, name, metadata hash, quote, mode, `virtualQuote0`, curve hash, expiry, chain, `authId`.

Durable anti-spam state lives in Postgres/SQLite (`admission_hits`, challenges, image hashes, issuance, receipts). Not process-local `Map`s.

Turnstile is validated against Cloudflare when `TURNSTILE_SECRET` is set. LOCAL may skip only when the secret is unset and `TURNSTILE_REQUIRED` is not `1`.

A refundable launch bond is **FUTURE** — not collected. No KYC.

See `LAUNCH_ADMISSION.md`, [Creators](/docs/creators), [Tickers](/docs/tickers).
