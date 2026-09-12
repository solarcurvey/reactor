# Launch admission

> Protocol **0.3.0**. CHALLENGE ≠ ALLOW. A solved challenge can ALLOW under limits.

`POST /launch/authorize` is the public path. Direct isolated-signer calls without an ALLOW receipt fail.

## Flow

1. **Admission** — ticker, reserved list, factory, quote, metadata, **real Cloudflare Turnstile**, wallet/session/IP rates, image-hash, funding-cluster, global issuance.
2. **CHALLENGE** returns 403, no receipt. The launch page renders the Turnstile widget, collects a real token, and re-admits. ELEVATED/ATTACK require Turnstile; they do **not** loop CHALLENGE after a valid token if the request is under rate + bucket limits.
3. **ALLOW** issues a short-lived HMAC receipt that includes `launchConfigHash` (creator, ticker, name, metadata, quote, mode, factory, Factory version, curve/config).
4. Isolated signer consumes the receipt **atomically** (`UPDATE … RETURNING` / SQLite `BEGIN IMMEDIATE`) and consumes one **signed-auth** token from the global bucket.
5. Signer recomputes `launchConfigHash` and refuses a mismatch. Then EIP-712.

## Issuance throttle

Durable shared token-bucket in Postgres/SQLite (`issuance_bucket`). Optional Redis `EVAL` when `REDIS_URL` is set. **Counts signed LaunchAuthorizations**, not admit ALLOW hits.

| Level | Hourly signed-auth cap | How it is entered |
| --- | ---: | --- |
| NORMAL | 120 | < 60 signed / hour |
| ELEVATED | 40 | ≥ 60 |
| ATTACK | 12 | ≥ 200 |

`ISSUANCE_LEVEL` env overrides the computed level.

## Funding-cluster (honest)

- **Network rename:** ASN + IPv4 /16.
- **Onchain funder (lightweight):** first USDC `Transfer` `from` in a bounded `eth_getLogs` lookback, when RPC + `USDC_ADDRESS` exist.
- Same funder → same cluster. **No KYC.** Not a chain-analysis product.

## Fair vs Instant curve binding

Instant `curveConfig` is `INSTANT_CURVE_V1`. Fair is `keccak256(abi.encode(supply, decimals, duration, auctionBps, minRaise))` after protocol defaults. `FAIR_V1` is an identifier only.

Turnstile: Cloudflare `siteverify` when `TURNSTILE_SECRET` is set. LOCAL bypass only if the secret is unset and `TURNSTILE_REQUIRED !== 1`. The web widget uses `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

See `LAUNCH_ADMISSION.md`, [Creators](/docs/creators), [Tickers](/docs/tickers).
