# How REACTOR works

REACTOR is a token launchpad for **Arc**. Creators launch a market that pays holders in the **quote they pick**. Official pools are Uniswap v4 with a **0% LP fee**. The **3.5%** quote-side charge is hook custom accounting: **2% holders / 1% Top-10 / 0.5% CORE**.

This software is **not audited**. There is **no public mainnet**. Local and test use only.

## Paths

| Audience | Start here |
| --- | --- |
| Trader | [Trade on REACTOR](/docs/traders) |
| Creator | [Launch a token](/docs/creators) |
| Builder | [API, SDK, events](/docs/builders) |

## The machine

```
Creator → LaunchAdmission → Launch Signer (EIP-712)
        → TickerRegistry.claimOnLaunch (24h lock)
        → InstantCurve  or  Batch Fair
        → graduate → locked official v4 (0% LP)
        → 3.5% quote split on every official trade
```

Instant Launch is **bonding curve → ready → frozen → graduate → locked v4**. Not single-sided v4 from trade #1. Creators have no supply, FDV, or fee knobs.

## What is frozen

The 3.5% split, Standard vs Rewards, curve constants, Dev Buy cap, CORE 10/90 genesis, Top-10 structural checks, nested-quote valuation, Keeper/Guardian routing security. A different split is a V2 factory, not a parameter.

## Trust, said plainly

- Guardian can pause and quarantine. Guardian cannot steal LP or rewrite the 2/1/0.5 split.
- Keeper maintains pots with simulated `minOut`. Keeper cannot configure.
- Top-10 membership is an **offchain API**. That is a **TRUST ASSUMPTION**.
- Launch Signer is isolated. Every launch, including USDC, needs a short-lived authorization.
- Indexer prices and charts are not onchain truth.

Continue: [curve math](/docs/curve) · [nested fees](/docs/fees) · [Guardian](/docs/guardian) · [tickers](/docs/tickers)
