# For creators

> Protocol **0.2.0**. You pick image, name, ticker, description, quote, Standard vs Rewards, optional Dev Buy (5% token-out). Protocol owns 1B / 18 supply, curve, FDV, and 3.5% fees.

## Ticker

Canonical: uppercase `A–Z0–9`, max 10. No Unicode. Reserved: CORE, REACTOR, USDC, ZEC, WBTC, EURC.

A successful launch locks that ticker **globally for 24 hours**. Failed or expired authorization does **not** squat. Permanent lock is Guardian judgment on a **REACTOR-native** token from an authorized factory with a matching ticker. Reserved names use a separate `reserveTicker`. Both are irreversible. See [Ticker Registry](/docs/tickers).

## Authorization

Public path: `POST /launch/authorize`.

1. Admission (ticker / factory / quote / metadata / Turnstile / rates / funding-cluster).
2. ALLOW → HMAC receipt. CHALLENGE ≠ ALLOW — complete Turnstile. DENY stops.
3. Isolated signer (loopback + receipt). Not a public signer.
4. EIP-712 binds creator, factory, Factory **V1**, ticker, **name**, **metadata hash**, quote, mode, `virtualQuote0`, curve hash, expiry, chain, `authId`.

Identity is frozen at launch. Creators cannot edit name/ticker/metadata after `metaFrozen`.

No KYC. A refundable bond is **not collected** (FUTURE).

## Instant vs Batch Fair

- **Instant:** curve opens immediately. Optional atomic Dev Buy (full 3.5%, 5% token-out cap). Anyone may `graduate()` once ready — reserved 20.69% + real curve quote lock as full-range v4 forever.
- **Batch Fair:** pro-rata timed sale, 0% during bids, then one finalize to official liquidity.

You cannot set FDV, supply, or fees. Those knobs are not in the product.
