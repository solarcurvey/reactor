# How REACTOR works

> Protocol **0.3.3** · Factory **V1** (immutable) · Not audited · No public mainnet

REACTOR is a token launchpad for **Arc**. Creators launch a market that pays holders in the **quote they pick**. Official pools are Uniswap v4 with a **0% LP fee**. The **3.5%** quote-side charge is hook custom accounting: **2% holders / 1% Top-10 / 0.5% CORE**.

This software is **not audited**. There is **no public mainnet**. Local and test use only.

## Paths

| Audience | Start here |
| --- | --- |
| Trader | [Trade on REACTOR](/docs/traders) |
| Creator | [Launch a token](/docs/creators) |
| Builder | [API, SDK, events](/docs/builders) · [Read path](/docs/perf) · [UI QA](/docs/qa) |
| Protocol | [Curve](/docs/curve) · [Fees](/docs/fees) · [Quoter](/docs/quoting) · [Trust](/docs/trust) · [Operator policy](/docs/operator-policy) · [Restricted access](/docs/restricted-access) |
| Reference | [API](/docs/api) · [Arc](/docs/arc) · [FAQ](/docs/faq) · [CI](/docs/ci) · [Versioning](/docs/versioning) · [Repo publicization](/docs/publicization) |

## The machine

```
Creator → Turnstile widget (real token)
        → POST /launch/authorize
        → LaunchAdmissionService
        → ALLOW receipt + launchConfigHash
        → isolated Launch Signer (atomic consume + signed-auth bucket)
        → EIP-712 LaunchAuthorization (full immutable identity)
        → InstantLaunchModule verifies + creates ReactorToken
        → TickerRegistry.claimOnLaunch (24h lock)
        → InstantCurve  or  Batch Fair (fairCurveConfig)
        → graduate → locked official v4 (0% LP)
        → 3.5% quote split on every official trade
```

CHALLENGE is **not** ALLOW. A solved challenge **can** ALLOW under ELEVATED/ATTACK limits. The signer is not a public API.

Instant Launch is **bonding curve → ready → frozen → graduate → locked v4**. Not single-sided v4 from trade #1. Creators have no supply, FDV, or fee knobs. Token name, ticker, and metadata hash are frozen in the signature and onchain at launch.

## What is frozen

The 3.5% split, Standard vs Rewards, curve constants, Dev Buy cap (5%), 1B supply, CORE 10/90 genesis, Top-10 structural checks, nested-quote valuation, Keeper/Guardian routing security. A different split is a V2 factory, not a parameter. Factory V1 runtime stays ≤ 23,552 (measured 23,286 after `registerNative` no longer swallows errors). New logic lives in modules, libs, and the backend.

## Top-10 TRUST ASSUMPTION

**#1 — Top-10 membership is an offchain API.** Indexer `GET /top10` ranks from ValuationService + persisted `current_supply`. Snapshots older than 15 minutes are not served or submitted. Contracts check structure (length, weights, CORE exclusion) only. They do not compute ranks. A compromised indexer or Keeper can submit a legal-looking epoch that is economically wrong. Treat ranks as **trusted computation**, not an oracle.

See [Trust](/docs/trust) for the rest of the top 10.

## Trust, said plainly

- Guardian can pause and quarantine. Guardian cannot steal LP or rewrite the 2/1/0.5 split.
- Keeper maintains pots with simulated `minOut`. Keeper cannot configure. One leadership lease — atomic `leader_locks` only. Live leaders renew; a lost fence refuses broadcast (no split-brain).
- Launch Signer is isolated. Every launch, including USDC, needs a short-lived authorization that already passed admission. If the durable store is unavailable, the signer returns 503 and does not sign.
- Indexer prices and charts are not onchain truth. Event rows and the ingest cursor commit together; a crash does not persist one without the other.
- Quote tickets are **one `UserRouteQuoter` eth_call** per candidate. The selected path, `amountOut`, hop kinds, `minOut`s, `feeLegs[]`, and terminal official/bonding result are the **same** `pickBest` winner. `PreviewRoute` is `plannedHops + 1`. Nested official 3.5% legs compound to 6.88% for two hops. `minOut` is never 0 or 1. SELL uses two floors from that preview: `minQuoteOut` (first-leg quote) and `minOut` (final USDC).
- Arc finality is deterministic BFT — no eth-8 lag. Native gas is USDC-18; protocol USDC is 6 decimals.
- Token names / tickers / descriptions / URLs / images are **untrusted** in the public UI. No raw HTML. [Browser security](/docs/web-security).
- Exact official-list address screening (`GET /sanctions/screen`) is **not** legal/OFAC compliance. It is the `#61` lookup used by the operator-policy gate. [Address screening](/docs/sanctions).
- Geo jurisdiction checks are a **server** ALLOW / DENY / UNKNOWN policy over trusted edge metadata. The UI does not ship a country deny list. Not a legal opinion. HTTP enforcement is [Operator policy](/docs/operator-policy). [Geo policy](/docs/geo-policy).
- Operator policy (recovered wallet proof + trusted geo + official-list freshness) is enforced on REACTOR-operated write/authorization APIs only. A stale or missing official-list snapshot (7-day SLA) fail-closes those writes as temporarily unavailable. `GET /operator-policy/status` is the public decision read for hosted UX. `/restricted` is the dedicated launchpad state. Public market/docs reads and onchain contracts are not this gate. [Operator policy](/docs/operator-policy) · [Restricted access](/docs/restricted-access) · [Sanctions ops](/docs/sanctions-ops).

Continue: [curve math](/docs/curve) · [nested fees](/docs/fees) · [Guardian](/docs/guardian) · [Keeper](/docs/keeper) · [tickers](/docs/tickers) · [admission](/docs/admission) · [operator policy](/docs/operator-policy) · [restricted access](/docs/restricted-access) · [browser security](/docs/web-security) · [address screening](/docs/sanctions) · [geo policy](/docs/geo-policy) · [sanctions ops](/docs/sanctions-ops) · [incident response](/docs/incident-response) · [repo publicization](/docs/publicization)
