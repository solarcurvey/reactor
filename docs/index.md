# How REACTOR works

> Protocol **0.2.0** · Factory **V1** (immutable) · Not audited · No public mainnet

REACTOR is a token launchpad for **Arc**. Creators launch a market that pays holders in the **quote they pick**. Official pools are Uniswap v4 with a **0% LP fee**. The **3.5%** quote-side charge is hook custom accounting: **2% holders / 1% Top-10 / 0.5% CORE**.

This software is **not audited**. There is **no public mainnet**. Local and test use only.

## Paths

| Audience | Start here |
| --- | --- |
| Trader | [Trade on REACTOR](/docs/traders) |
| Creator | [Launch a token](/docs/creators) |
| Builder | [API, SDK, events](/docs/builders) |
| Protocol | [Curve](/docs/curve) · [Fees](/docs/fees) · [Trust](/docs/trust) |
| Reference | [API](/docs/api) · [FAQ](/docs/faq) · [Versioning](/docs/versioning) |

## The machine

```
Creator → POST /launch/authorize
        → LaunchAdmissionService (ticker / factory / quote / metadata / Turnstile / risk / throttle)
        → ALLOW receipt only
        → isolated Launch Signer (private network OR AdmissionReceipt)
        → EIP-712 LaunchAuthorization (full immutable identity)
        → InstantLaunchModule verifies + creates ReactorToken
        → TickerRegistry.claimOnLaunch (24h lock)
        → InstantCurve  or  Batch Fair
        → graduate → locked official v4 (0% LP)
        → 3.5% quote split on every official trade
```

CHALLENGE is **not** ALLOW. A challenge without a completed Turnstile token does not produce a signature. The signer is not a public API.

Instant Launch is **bonding curve → ready → frozen → graduate → locked v4**. Not single-sided v4 from trade #1. Creators have no supply, FDV, or fee knobs. Token name, ticker, and metadata hash are frozen in the signature and onchain at launch.

## What is frozen

The 3.5% split, Standard vs Rewards, curve constants, Dev Buy cap (5%), 1B supply, CORE 10/90 genesis, Top-10 structural checks, nested-quote valuation, Keeper/Guardian routing security. A different split is a V2 factory, not a parameter.

## Top-10 TRUST ASSUMPTION

**#1 — Top-10 membership is an offchain API.** Contracts check structure (length, weights, CORE exclusion) only. They do not compute ranks. A compromised indexer or Keeper can submit a legal-looking epoch that is economically wrong. Treat ranks as **trusted computation**, not an oracle.

See [Trust](/docs/trust) for the rest of the top 10.

## Trust, said plainly

- Guardian can pause and quarantine. Guardian cannot steal LP or rewrite the 2/1/0.5 split.
- Keeper maintains pots with simulated `minOut`. Keeper cannot configure. One leadership lease — not mixed with advisory locks.
- Launch Signer is isolated. Every launch, including USDC, needs a short-lived authorization that already passed admission.
- Indexer prices and charts are not onchain truth.
- Quote tickets simulate **exact RouteGraph edges** (`OFFICIAL_REACTOR_V4` / `EXTERNAL_V4_HOOKLESS` / `BONDING_CURVE`). They never invent a generic 0.30% hookless pool. If simulation fails the route is **unavailable**. `minOut` is never 0 or 1.

Continue: [curve math](/docs/curve) · [nested fees](/docs/fees) · [Guardian](/docs/guardian) · [Keeper](/docs/keeper) · [tickers](/docs/tickers)
