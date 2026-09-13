# Launch admission

Offchain `LaunchAdmissionService` (indexer) plus onchain `LaunchAuthorization`.

**Invariant:** no `LaunchAuthorization` signature unless the request passed admission with **ALLOW**. CHALLENGE ≠ ALLOW. A solved Turnstile can ALLOW under ELEVATED/ATTACK limits.

## Public flow

`POST /launch/authorize` → **operator policy** (recovered-wallet `#61` screen + trusted geo; fail closed) → admission (ticker / factory / quote / metadata / **real Turnstile** / risk / throttle) → ALLOW receipt with `launchConfigHash` → isolated signer (atomic consume + issuance bucket) → EIP-712.

The policy gate is one shared module (`evaluateOperatorPolicy` / `gateProtectedWrite`). Subject is the EIP-191 recovered signer, not `body.wallet`. Address screen uses merged `#66` `indexerSanctionsStore().screen` when bound. Browser country / “clear” flags are ignored. Public `GET` market/docs paths (including `/sanctions/screen`) are not gated. Immutable contracts remain callable onchain. See `docs/operator-policy.md`. Issue **#62** (parent RELEASE GATE **#60**).

The isolated signer binds `127.0.0.1`. Direct public calls without a receipt fail. Signer requires receipt `launchConfigHash` to match creator, ticker, name, metadata, quote, mode, factory, Factory version, curve/config.

**Fail closed on store.** The isolated signer will not mint a `LaunchAuthorization` if Postgres/SQLite cannot be opened. `openStore` failure is `SIGNER_STORE_UNAVAILABLE` (HTTP 503), never coerced to `undefined`. Receipt consume and the signed-auth issuance bucket always run against durable state. A down store is an outage, not a bypass.

## Onchain (every launch, including USDC)

EIP-712 signed by the isolated **Launch Signer** (≠ Keeper ≠ Guardian Safe). Guardian rotates the signer.

Bound identity: creator, factory, Factory version, ticker, name, metadata hash, quote, mode, `virtualQuote0`, curve hash, expiry, chain, unique `authId`. Replay is digest-level on `TickerRegistry`. No serial quote nonce.

Instant `curveConfig` = `INSTANT_CURVE_V1`. Fair binds `fairCurveConfig(supply, decimals, duration, auctionBps, minRaise)` after defaults.

Metadata is frozen at launch (`metaFrozen`).

usdPegOne quotes still need the signature. `virtualQuote0` must match protocol geometry (or 0 → protocol default). ValuationService prices every quote from the **accepted consensus** mark (configured provider registry, not hardcoded ZEC/WBTC). **PROD:** no static marks. Provider outage, staleness, or deviation refuses authorization.

## Offchain signals → ALLOW / CHALLENGE / DENY

Ticker, quote, factory, metadata, wallet, session, IP, ASN, client, Cloudflare Turnstile widget + `siteverify`, global signed-auth token-bucket, funding-parent heuristic (network /16+ASN and/or first USDC funder, bounded lookback), image-hash. Creator image / website / X / Telegram must pass the shared URL allowlist (`packages/reactor/src/untrusted-metadata.ts`). HTML names and `javascript:` / `data:` media are **DENY**.

**Production hard gates:** outside `REACTOR_ENV=LOCAL`, missing Turnstile secret/site key, `SIGNER_INLINE`, or an Anvil `#0` signer key refuses start and launch.

Geo / jurisdiction policy (`evaluateRequestGeo`, issue #63) is a separate server ALLOW / DENY / UNKNOWN layer over trusted edge metadata. It is **not** part of Turnstile admission and is **not** applied as an HTTP gate here (#62).

**Official-list freshness:** admit, authorize, and the isolated signer fail closed when the screening dataset is stale or missing (issue #64). Failed refresh retains last-known-good. See `/docs/sanctions-ops`.

Durable state in Postgres/SQLite: `admission_hits`, challenges, image hashes, `issuance_bucket`, receipts. Optional Redis. Not process-local Maps. The signer treats store unavailability as deny, not as “no durable checks.”

**Time units:** `admission_hits.ts` and `issuance_bucket.updated_ms` are wall-clock **milliseconds** (`Date.now()`). Challenge `created_ts` / `solved_ts`, image-hash `first_seen`, receipt `expires`/`ts`, and `launch_auths.ts` are **unix seconds**. Millisecond columns are `BIGINT` (schema v6) because Postgres `INTEGER` is 32-bit and cannot store ~1.8e12. See `ARCHITECTURE.md`.

Receipt consume is atomic. Concurrent consume: one winner. A receipt without a durable `id` cannot skip consume.

`permanentlyLockTicker` reverts `TickerUnavailable` if **another** token still holds the active 24h lock.

**No KYC.** A refundable launch bond is **FUTURE only** — not collected.

## APIs

| Route | Who |
| --- | --- |
| `POST /launch/admit` | Public + partner (`x-partner-key`) — decision only. JSON **16KiB** default / **64KiB** hard max (chunked included). |
| `POST /launch/authorize` | Public — admission then isolated sign. Same JSON cap. |
| Isolated signer `:43149` | Receipt or internal token. Not public. |
| `GET /ticker/:ticker` | Anyone |
| `@reactor/sdk` `ReactorClient.authorize` | Third-party terminals |
