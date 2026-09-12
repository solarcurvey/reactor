# Launch admission

> Protocol **0.3.2**. CHALLENGE ≠ ALLOW. A solved challenge can ALLOW under limits.

`POST /launch/authorize` is the public path. Direct isolated-signer calls without an ALLOW receipt fail.

## Flow

1. **Admission** — ticker, reserved list, factory, quote, metadata, **real Cloudflare Turnstile**, wallet/session/IP rates, image-hash, funding-cluster, global issuance.
2. **CHALLENGE** returns 403, no receipt. The launch page renders the Turnstile widget, collects a real token, and re-admits. ELEVATED/ATTACK require Turnstile; they do **not** loop CHALLENGE after a valid token if the request is under rate + bucket limits.
3. **ALLOW** issues a short-lived HMAC receipt that includes `launchConfigHash` (creator, ticker, name, metadata, quote, mode, factory, Factory version, curve/config).
4. Isolated signer consumes the receipt **atomically** (`UPDATE … RETURNING` / SQLite `BEGIN IMMEDIATE`) and consumes one **signed-auth** token from the global bucket.
5. Signer recomputes `launchConfigHash` and refuses a mismatch. Then EIP-712.

## Issuance throttle

Durable shared token-bucket in Postgres/SQLite (`issuance_bucket`). Optional Redis `EVAL` when `REDIS_URL` is set. **Counts signed LaunchAuthorizations**, not admit ALLOW hits.

`admission_hits.ts` and `issuance_bucket.updated_ms` are **milliseconds** (`Date.now()`), stored as `BIGINT` on Postgres (schema v6). Receipt `expires` / `admission_receipts.ts` / challenge timestamps are **unix seconds**. Do not mix units in the same column. Canonical table: `ARCHITECTURE.md` (Offchain).

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

## Fair vs Instant curve binding

Instant `curveConfig` is `INSTANT_CURVE_V1`. Fair is `keccak256(abi.encode(supply, decimals, duration, auctionBps, minRaise))` after protocol defaults. `FAIR_V1` is an identifier only.

Turnstile: Cloudflare `siteverify` when `TURNSTILE_SECRET` is set. LOCAL bypass only if the secret is unset and `TURNSTILE_REQUIRED !== 1`. The web widget uses `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

**Production hard gates** (`REACTOR_ENV=PROD` / `NODE_ENV=production` and not `LOCAL`): the indexer and isolated signer **refuse to start** (and `POST /launch/authorize` refuses) if `TURNSTILE_SECRET` or the site key is missing, if `SIGNER_INLINE` would be used, or if the signer key is missing / is Anvil `#0`. LOCAL may keep those bypasses.

See `LAUNCH_ADMISSION.md`, [Creators](/docs/creators), [Tickers](/docs/tickers).
