# Launch admission

Offchain `LaunchAdmissionService` (indexer) plus onchain `LaunchAuthorization`.

**Invariant:** no `LaunchAuthorization` signature unless the request passed admission with **ALLOW**. CHALLENGE ≠ ALLOW.

## Public flow

`POST /launch/authorize` → admission (ticker / factory / quote / metadata / Turnstile / risk / throttle) → compute pricing → **internal signer only** (private network OR `AdmissionReceipt`) → return auth.

The isolated signer binds `127.0.0.1`. Direct public calls without a receipt fail.

## Onchain (every launch, including USDC)

EIP-712 signed by the isolated **Launch Signer** (≠ Keeper ≠ Guardian Safe). Guardian rotates the signer.

Bound identity: creator, factory, Factory version, ticker, name, metadata hash, quote, mode, `virtualQuote0`, curve hash, expiry, chain, unique `authId`. Replay is digest-level on `TickerRegistry`. No serial quote nonce.

Metadata is frozen at launch (`metaFrozen`). Creators cannot edit identity after launch.

usdPegOne quotes still need the signature. `virtualQuote0` must match protocol geometry (or 0 → protocol default).

## Offchain signals → ALLOW / CHALLENGE / DENY

Ticker, quote, factory, metadata, wallet, session, IP, ASN, client, Cloudflare Turnstile, global rate, funding-cluster, image-hash.

Durable state in Postgres/SQLite: `admission_hits`, challenges, image hashes, issuance, receipts. Not process-local Maps.

Global issuance: `NORMAL` / `ELEVATED` / `ATTACK` (env override or recent ALLOW count). Guardian still has `pauseLaunches`.

Turnstile is validated at `https://challenges.cloudflare.com/turnstile/v0/siteverify` when `TURNSTILE_SECRET` is set.

**No KYC.** A refundable launch bond is **FUTURE only** — not collected.

## APIs

| Route | Who |
| --- | --- |
| `POST /launch/admit` | Public + partner (`x-partner-key`) — decision only |
| `POST /launch/authorize` | Public — admission then isolated sign |
| Isolated signer `:43149` | Receipt or internal token. Not public. |
| `GET /ticker/:ticker` | Anyone |
| `@reactor/sdk` `ReactorClient.authorize` | Third-party terminals |
