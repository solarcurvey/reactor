# How REACTOR works

> Protocol **{{protocolVersion}}** · Factory **{{factoryVersionLabel}}** (immutable) · Not audited · No public mainnet

REACTOR is a token launchpad for **Arc**. Creators launch a market that pays holders in the **quote they pick**. Official pools are Uniswap v4 with a **0% LP fee**. The **3.5%** quote-side charge is hook custom accounting: **2% holders / 1% Top-10 / 0.5% CORE**.

This software is **not audited**. There is **no public mainnet**. Local and test use only. Do not deploy to Arc Mainnet (chain **5042**).

This handbook is the in-app reading path. Root files such as `ECONOMICS.md` and `ARCHITECTURE.md` remain the auditor-facing source. The numbers on these pages must match `ReactorConstants`. CI (`pnpm docs:check`) fails on drift.

## Read in this order

| If you are… | Start here | Then |
| --- | --- | --- |
| Trying the local demo | [Local demo](/docs/local) | [Traders](/docs/traders) |
| Trading | [Traders](/docs/traders) | [Fees](/docs/fees) · [Quoter](/docs/quoting) |
| Launching a token | [Creators](/docs/creators) | [Admission](/docs/admission) · [Tickers](/docs/tickers) |
| Integrating a terminal | [Builders](/docs/builders) | [API](/docs/api) · [SDK](/docs/sdk) · [Observability](/docs/observability) · [Read path](/docs/perf) · [UI QA](/docs/qa) |
| Reviewing economics | [Economics](/docs/economics) | [Curve](/docs/curve) · [CORE](/docs/core) · [Rewards](/docs/rewards) |
| Reviewing trust | [Trust](/docs/trust) | [Security](/docs/security) · [Guardian](/docs/guardian) · [EOA genesis](/docs/eoa-genesis) · [Keeper](/docs/keeper) · [Automation](/docs/automation) · [Operator policy](/docs/operator-policy) · [Restricted access](/docs/restricted-access) · [Address screening](/docs/sanctions) · [Geo policy](/docs/geo-policy) · [Repo publicization](/docs/publicization) |
| Operating CI | [CI and cost](/docs/ci) | [Docs policy](/docs/policy) · [Repo publicization](/docs/publicization) · [UI QA](/docs/qa) |

## What REACTOR is

A complete economic loop on Arc:

1. Creator launches **Instant** (bonding curve → locked v4) or **Batch Fair** (timed pro-rata sale → locked v4).
2. Traders buy and sell **exact-in**. Incomplete fills revert. `minOut` is never 0 or 1.
3. Holders claim **same-quote** rewards with no staking. Transfers have **zero tax**.
4. A designated **Keeper** settles the 1% Top-10 pot, SelfBurn, and CORE buy+burn.
5. An immutable **Guardian** can pause and quarantine. It cannot steal locked LP or rewrite the 2 / 1 / 0.5 split.

Tokens are normal ERC-20s: mint once, no owner mint, no blacklist, no pause, no transfer tax.

## What this is not

- Not single-sided Uniswap v4 from trade #1. Instant is **bonding curve → ready → frozen → graduate → locked v4**.
- Not CORE Instant. CORE is genesis **100M vest + 900M locked** official CORE/USDC. Never Top-10.
- Not a creator-fee or platform-cash launchpad. No creation fee, referral cut, or token-level sell tax.
- Not Uniswap CCA and not InstantLaunchStrategy. Fair is a REACTOR batch sale.
- Not a trustless Top-10 oracle. Ranks are an **offchain API**. Contracts check structure only.
- Not audited. Not mainnet. Not Marvel / Iron Man / “Arc Reactor” branding.

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

Instant Launch is **bonding curve → ready → frozen → graduate → locked v4**. Creators have no supply, FDV, or fee knobs. Token name, ticker, and metadata hash are frozen in the signature and onchain at launch.

## What is frozen

These are Factory **V1** constants. A different split, supply, Dev Buy cap, or curve is a **new factory** (V2), not a parameter on V1.

| Item | Frozen value |
| --- | --- |
| Official LP fee | **0%** |
| Protocol charge | **3.5%** of executed gross quote |
| Split | **2% holders / 1% Top-10 / 0.5% CORE** |
| Launch supply | **1B / 18** |
| Instant inventory | **79.31%** curve / **20.69%** locked v4 |
| Instant start FDV | **~$5k** USDC-equivalent |
| Dev Buy | Optional, **≤5%** token-out, full 3.5% |
| Ticker lock | **24h** global on success |
| CORE genesis | **100M vest + 900M locked** official CORE/USDC |
| Official CORE book | **2.5% burn + 1% flywheel** (no holder 2%) |
| Factory runtime | V1 stays ≤ 23,552 (measured 23,286 after `registerNative` no longer swallows errors) |

New logic lives in modules, libs, and the backend. Factory V1 stays V1 forever.

## Top-10 TRUST ASSUMPTION

**#1 — Top-10 membership is an offchain API.** Indexer `GET /top10` ranks from ValuationService + persisted `current_supply`. Snapshots older than 15 minutes are not served or submitted. Contracts check structure (length, weights, CORE exclusion) only. They do not compute ranks. A compromised indexer or job signer can submit a legal-looking epoch that is economically wrong. Relayers / CRE cannot substitute ranking. Treat ranks as **trusted computation**, not an oracle.

See [Trust](/docs/trust) for the rest of the handbook list.

## Trust, said plainly

- Guardian can pause and quarantine. Guardian cannot steal LP or rewrite the 2/1/0.5 split.
- Keeper maintains pots with simulated `minOut`. Keeper cannot configure. One leadership lease — atomic `leader_locks` only. Live leaders renew; a lost fence refuses broadcast (no split-brain). Signed-job `AutomationGateway` is draft **#54**, not current `main`. CRE does not rank Top-10.
- Launch Signer is isolated. Every launch, including USDC, needs a short-lived authorization that already passed admission. If the durable store is unavailable, the signer returns 503 and does not sign.
- Indexer prices and charts are not onchain truth. Event rows and the ingest cursor commit together; a crash does not persist one without the other.
- Quote tickets are **one `UserRouteQuoter` eth_call** per candidate. The selected path, `amountOut`, hop kinds, `minOut`s, `feeLegs[]`, and terminal official/bonding result are the **same** `pickBest` winner. `PreviewRoute` is `plannedHops + 1`. Nested official 3.5% legs compound to 6.88% for two hops. `minOut` is never 0 or 1. SELL uses two floors from that preview: `minQuoteOut` (first-leg quote) and `minOut` (final USDC).
- Arc finality is deterministic BFT — no eth-8 lag. Native gas is USDC-18; protocol USDC is 6 decimals.
- Token names / tickers / descriptions / URLs / images are **untrusted** in the public UI. No raw HTML. [Browser security](/docs/web-security).
- Exact official-list address screening (`GET /sanctions/screen`) is **not** legal/OFAC compliance. It is the `#61` lookup used by the operator-policy gate. [Address screening](/docs/sanctions).
- Geo jurisdiction checks are a **server** ALLOW / DENY / UNKNOWN policy over trusted edge metadata. The UI does not ship a country deny list. Not a legal opinion. HTTP enforcement is [Operator policy](/docs/operator-policy). [Geo policy](/docs/geo-policy).
- Operator policy (recovered wallet proof + trusted geo + official-list freshness) is enforced on REACTOR-operated write/authorization APIs only. A stale or missing official-list snapshot (7-day SLA) fail-closes those writes as temporarily unavailable. `GET /operator-policy/status` is the public decision read for hosted UX. `/restricted` is the dedicated launchpad state. Public market/docs reads and onchain contracts are not this gate. [Operator policy](/docs/operator-policy) · [Restricted access](/docs/restricted-access) · [Sanctions ops](/docs/sanctions-ops).
- The web app may send **redacted** failure telemetry (API / RPC / wallet / quote / SSE / tx / media / simulation / error boundaries) tagged with the build SHA, `reactorEnv`, `chainId`, and `buildTimestamp`. User-visible failures show `ref {traceId}`. No private keys, signatures, or Turnstile tokens. Optional Sentry. Not an oracle. [Observability](/docs/observability).

Continue: [local demo](/docs/local) · [economics](/docs/economics) · [lifecycle](/docs/lifecycle) · [curve math](/docs/curve) · [nested fees](/docs/fees) · [Guardian](/docs/guardian) · [Keeper](/docs/keeper) · [Automation](/docs/automation) · [operator policy](/docs/operator-policy) · [restricted access](/docs/restricted-access) · [address screening](/docs/sanctions) · [geo policy](/docs/geo-policy) · [sanctions ops](/docs/sanctions-ops) · [incident response](/docs/incident-response) · [browser security](/docs/web-security) · [observability](/docs/observability) · [CI and cost](/docs/ci) · [brand](/docs/brand) · [repo publicization](/docs/publicization)
