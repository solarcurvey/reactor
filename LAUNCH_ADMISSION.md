# Launch admission

Offchain `LaunchAdmissionService` (indexer) plus onchain `LaunchAuthorization`.

**Invariant:** no `LaunchAuthorization` signature unless the request passed admission with **ALLOW**. CHALLENGE ≠ ALLOW. A solved Turnstile can ALLOW under ELEVATED/ATTACK limits.

## Public flow

`POST /launch/authorize` → admission (ticker / factory / quote / metadata / **real Turnstile** / risk / throttle) → ALLOW receipt with `launchConfigHash` → isolated signer (atomic consume + issuance bucket) → EIP-712.

The isolated signer binds `127.0.0.1`. Direct public calls without a receipt fail. Signer requires receipt `launchConfigHash` to match creator, ticker, name, metadata, quote, mode, factory, Factory version, curve/config.

## Onchain (every launch, including USDC)

EIP-712 signed by the isolated **Launch Signer** (≠ Keeper ≠ Guardian Safe). Guardian rotates the signer.

Bound identity: creator, factory, Factory version, ticker, name, metadata hash, quote, mode, `virtualQuote0`, curve hash, expiry, chain, unique `authId`. Replay is digest-level on `TickerRegistry`. No serial quote nonce.

Instant `curveConfig` = `INSTANT_CURVE_V1`. Fair binds `fairCurveConfig(supply, decimals, duration, auctionBps, minRaise)` after defaults.

Metadata is frozen at launch (`metaFrozen`).

usdPegOne quotes still need the signature. `virtualQuote0` must match protocol geometry (or 0 → protocol default). ValuationService prices every quote. **PROD:** no static ZEC.

## Offchain signals → ALLOW / CHALLENGE / DENY

Ticker, quote, factory, metadata, wallet, session, IP, ASN, client, Cloudflare Turnstile widget + `siteverify`, global signed-auth token-bucket, funding-cluster (network /16+ASN and/or first USDC funder), image-hash.

Durable state in Postgres/SQLite: `admission_hits`, challenges, image hashes, `issuance_bucket`, receipts. Optional Redis. Not process-local Maps.

Receipt consume is atomic. Concurrent consume: one winner.

`permanentlyLockTicker` reverts `TickerUnavailable` if **another** token still holds the active 24h lock.

**No KYC.** A refundable launch bond is **FUTURE only** — not collected.

## APIs

| Route | Who |
| --- | --- |
| `POST /launch/admit` | Public + partner (`x-partner-key`) — decision only |
| `POST /launch/authorize` | Public — admission then isolated sign |
| Isolated signer `:43149` | Receipt or internal token. Not public. |
| `GET /ticker/:ticker` | Anyone |
| `@reactor/sdk` `ReactorClient.authorize` | Third-party terminals |
