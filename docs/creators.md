# Launch a token

> Protocol **0.3.3**. You pick identity and quote. Protocol owns supply, curve, FDV, and fees.

Creators do **not** set starting FDV, total supply, or the 3.5% split. Instant uses one protocol curve. Fair uses protocol defaults hashed into the signature.

## What you choose

| Field | Instant | Fair |
| --- | --- | --- |
| Image, name, ticker, description | Yes | Yes |
| Quote asset | Yes (USDC, ZEC, WBTC, …) | Yes |
| Standard vs Rewards | Yes | Rewards after the sale |
| Optional Dev Buy | ≤5% token-out, full 3.5% | No |
| Auction length | — | Minutes (protocol defaults fill the rest) |

Supply is **1B / 18**. Instant: 79.31% on the bonding curve, 20.69% locked v4 at graduation. Fair: pro-rata timed sale, **0% during the sale**, 50/50 locked at clear.

## Admission is mandatory

Every launch, including USDC, goes through `POST /launch/authorize`. REACTOR-operated admit / authorize / upload / quote paths also run the [operator policy](/docs/operator-policy) gate (connected wallet + trusted geo) **before** a receipt or signature. That is a hosted-service control, not an onchain block.

1. The launch page renders a **real Cloudflare Turnstile** widget (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`). There is no `window.turnstileToken` stub.
2. Admission returns **ALLOW**, **CHALLENGE**, or **DENY**. CHALLENGE is **not** a signature.
3. On CHALLENGE, solve the widget and retry. ELEVATED / ATTACK still **ALLOW** after a real token if you are under rate + issuance limits. They do not loop forever.
4. ALLOW carries `launchConfigHash` (creator, ticker, name, metadata, quote, mode, factory, Factory V1, curve/config).
5. The isolated signer consumes the receipt **once** (durable store required — a down database is 503, not a signature) and checks the hash. Then EIP-712.

Turnstile `siteverify` runs when `TURNSTILE_SECRET` is set. LOCAL bypass only if the secret is unset and `TURNSTILE_REQUIRED !== 1`.

## Instant vs Fair binding

- **Instant** `curveConfig` is `INSTANT_CURVE_V1`. Same geometry every time.
- **Fair** `curveConfig` is `keccak256(abi.encode(supply, decimals, duration, auctionBps, minRaise))` after protocol defaults. `FAIR_V1` is an identifier only — a signature that still hashes `FAIR_V1` reverts `WrongParams`.

## Tickers

On success the ticker takes a **24h global lock**. A second launch of the same ticker waits until that lock expires. Guardian can `permanentlyLockTicker` only for a REACTOR-native token that matches the ticker — **not** while a *different* token still holds the 24h lock. Reserved names (`CORE`, `USDC`, …) are a separate list.

Metadata (image, description, socials) is frozen at launch. No post-launch identity edit.

The launchpad treats that identity as **untrusted**. Names and descriptions are text (tags stripped). Website / X / Telegram render only on an allowlisted `https:` host. Images must be the upload path `/m/<id>.webp` (or a first-party icon). `javascript:`, `data:`, and raw HTML are rejected at admission and again in the UI. See [Browser security](/docs/web-security).

## After launch

Instant: bonding → ready → frozen → graduate → locked official v4 (0% LP). Holders earn the quote you picked from trade #1 (Rewards) or the 2% later market-buys and burns (Standard). Same 1% Top-10 + 0.5% CORE.

Fair: pro-rata bids during the window. Clearing price opens the official pool.

See [Admission](/docs/admission), [Tickers](/docs/tickers), [Curve](/docs/curve), [Fees](/docs/fees).
