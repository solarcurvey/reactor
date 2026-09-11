# For creators

You pick **image, name, ticker, description, quote, Standard vs Rewards**, and an optional Dev Buy. Protocol owns supply (1B / 18), curve, FDV, and fees.

## Ticker

Canonical: uppercase `A–Z0–9`, max 10. No Unicode. Reserved: CORE, REACTOR, USDC, ZEC, WBTC, EURC.

A successful launch locks that ticker **globally for 24 hours**. Failed or expired authorization does **not** squat. Permanent uniqueness is Guardian judgment, not an oracle. See [Ticker Registry](/docs/tickers).

## Authorization

Every launch — **including USDC** — needs a short-lived EIP-712 `LaunchAuthorization` from the isolated Launch Signer. The digest binds you, the quote, the active factory, and the ticker.

Admission may ALLOW, CHALLENGE (Turnstile), or DENY. No KYC. A refundable bond is **not collected** (documented as future).

## Instant vs Batch Fair

- **Instant:** curve opens immediately. Optional atomic Dev Buy (full 3.5%, 5% token-out cap). Anyone may `graduate()` once ready — reserved 20.69% + real curve quote lock as full-range v4 forever.
- **Batch Fair:** pro-rata timed sale, 0% during bids, then one finalize to official liquidity.

You cannot set FDV, supply, or fees. Those knobs are not in the product.
