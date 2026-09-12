# Launch admission

> Protocol **{{protocolVersion}}**. CHALLENGE ≠ ALLOW. A solved challenge can ALLOW under limits. Isolated signer is not public.

`POST /launch/authorize` is the public path. Direct isolated-signer calls without an ALLOW receipt fail. Public JSON POSTs (`/launch/authorize`, `/launch/admit`) are stream-capped at **16KiB** default / **64KiB** hard max (Content-Length and chunked); oversize is **413**.

Source: `LAUNCH_ADMISSION.md`.

**Operator policy (issue #62)** runs first on admit, authorize, and the isolated signer. The screened subject is the **recovered EIP-191 signer** of `GET /operator-policy/challenge` — not `body.wallet` / `x-reactor-wallet`. Address screen uses `#61` `indexerSanctionsStore().screen` / `GET /sanctions/screen` when that plugin is bound (lookup API stays ungated). Trusted geo is the other input. Deny is **403**; stale/unavailable required policy is **503**. Missing/invalid proof is **403**. No receipt or signature is issued. Browser country / “clear” / claimed-wallet flags are ignored. This does not block direct onchain Factory calls. The launchpad maps the same decision to [restricted-access](/docs/restricted-access) UX and disables Launch CTAs before a wallet prompt. See [Operator policy](/docs/operator-policy) and [Address screening](/docs/sanctions).

## Flow

1. **Admission** — ticker, reserved list, factory, quote, metadata, **real Cloudflare Turnstile**, wallet/session/IP rates, image-hash, funding-cluster, global issuance. Creator image / website / X / Telegram URLs are scheme-allowlisted; HTML names and `javascript:` / `data:` media **DENY** (not CHALLENGE).
2. **CHALLENGE** returns 403, no receipt. The launch page renders the Turnstile widget, collects a real token, and re-admits. ELEVATED/ATTACK require Turnstile; they do **not** loop CHALLENGE after a valid token if the request is under rate + bucket limits.
3. **ALLOW** issues a short-lived HMAC receipt that includes `launchConfigHash` (creator, ticker, name, metadata, quote, mode, factory, Factory version, curve/config).
4. Isolated signer requires a durable store. If Postgres/SQLite cannot be opened, signing returns **503** (`SIGNER_STORE_UNAVAILABLE`) and does **not** mint. There is no in-memory fallback that skips consume.
5. Isolated signer consumes the receipt **atomically** (`UPDATE … RETURNING` / SQLite `BEGIN IMMEDIATE`) and consumes one **signed-auth** token from the global bucket. Both steps always run. A receipt without a durable `id` is refused.
6. Signer recomputes `launchConfigHash` and refuses a mismatch. Then EIP-712.
7. **#64 freshness:** admit / authorize / isolated sign fail closed when the official-list snapshot is stale or missing. A failed refresh keeps last-known-good. [Sanctions ops](/docs/sanctions-ops).

## Onchain (every launch, including USDC)

EIP-712 signed by the isolated **Launch Signer** (≠ Keeper ≠ Guardian Safe). Guardian rotates the signer.

Bound identity: creator, factory, Factory version, ticker, name, metadata hash, quote, mode, `virtualQuote0`, curve hash, expiry, chain, unique `authId`. Replay is digest-level on `TickerRegistry`. No serial quote nonce. TTL ≤ **30 minutes**. Creator must be `msg.sender`. Domain `verifyingContract` is the **TickerRegistry**.

Instant `curveConfig` = `INSTANT_CURVE_V1`. Fair binds `fairCurveConfig(supply, decimals, duration, auctionBps, minRaise)` after defaults. `FAIR_V1` is an identifier only.

Metadata is frozen at launch (`metaFrozen`).

usdPegOne quotes still need the signature. `virtualQuote0` must match protocol geometry (or 0 → protocol default). ValuationService prices every quote from the **accepted consensus** mark. **PROD:** no static marks. Provider outage, staleness, or deviation refuses authorization.

## Issuance throttle

Durable shared token-bucket in Postgres/SQLite (`issuance_bucket`). Optional Redis `EVAL` when `REDIS_URL` is set. **Counts signed LaunchAuthorizations**, not admit ALLOW hits.

`admission_hits.ts` and `issuance_bucket.updated_ms` are **milliseconds** (`Date.now()`), stored as `BIGINT` on Postgres (schema v6). Receipt `expires` / `admission_receipts.ts` / challenge timestamps are **unix seconds**. Do not mix units in the same column.

| Level | Hourly signed-auth cap | How it is entered |
| --- | ---: | --- |
| NORMAL | 120 | < 60 signed / hour |
| ELEVATED | 40 | ≥ 60 |
| ATTACK | 12 | ≥ 200 |

`ISSUANCE_LEVEL` env overrides the computed level.

## Funding-parent heuristic (honest)

This is **not** chain analysis and **not** KYC. It is a rate-limit key.

- **Network rename:** ASN + IPv4 /16 (`networkCluster`).
- **Onchain funding-parent (lightweight):** first USDC `Transfer` `from` in a **bounded** `eth_getLogs` lookback (`FUNDING_PARENT_LOOKBACK_BLOCKS` = 50_000), when RPC + `USDC_ADDRESS` exist.
- Same first-USDC-funder → same `fundingParent` id. Otherwise wallet + network rename.
- Admission reason `funding-cluster` still means “too many launches from this heuristic id.” Do not read it as a clustering product.

A refundable launch bond is **FUTURE only** — not collected.

## Turnstile and production gates

Turnstile: Cloudflare `siteverify` when `TURNSTILE_SECRET` is set. LOCAL bypass only if the secret is unset and `TURNSTILE_REQUIRED !== 1`. The web widget uses `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

**Production hard gates** (`REACTOR_ENV=PROD` / `NODE_ENV=production` and not `LOCAL`): the indexer and isolated signer **refuse to start** (and `POST /launch/authorize` refuses) if `TURNSTILE_SECRET` or the site key is missing, if `SIGNER_INLINE` would be used, or if the signer key is missing / is Anvil `#0`. LOCAL may keep those bypasses.

Geo / jurisdiction policy is a **separate** server evaluator (`evaluateRequestGeo`, issue #63). It is not Turnstile admission and is not applied as a request gate on this path. See [Geo policy](/docs/geo-policy).

## APIs

| Route | Who |
| --- | --- |
| `POST /launch/admit` | Public + partner (`x-partner-key`) — decision only. JSON **16KiB** default / **64KiB** hard max. |
| `POST /launch/authorize` | Public — admission then isolated sign. Same JSON cap. |
| Isolated signer `:43149` | Receipt or internal token. Binds `127.0.0.1`. Not public. |
| `GET /ticker/:ticker` | Anyone |
| `@reactor/sdk` `ReactorClient.authorize` | Third-party terminals |

See [Creators](/docs/creators), [Tickers](/docs/tickers), [Valuation](/docs/valuation), [Troubleshooting](/docs/troubleshooting), [Operator policy](/docs/operator-policy).
