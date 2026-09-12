# Top-10

1% of official quote-side volume funds THE REACTOR. Ranks are an **offchain API**.

- Canonical compute: indexer `ValuationService` + persisted markets (`GET /top10`).
- 12-minute VWAP on indexed official trades. Nested quotes walk ValuationService ancestry (CAT → ZCAT → ZEC → USD). External spots do not control the official mark unless they are an accepted, fresh consensus `external_price_marks` row.
- Floor $250k. CORE excluded in the data plane and onchain. ≤10 names, weights 100%.
- Circulating supply is persisted `tokens.current_supply`, which tracks remaining onchain `totalSupply()` (token-level `Burned` / Transfer-to-zero + bounded reconcile). Not TokenCreated `tokens.supply` and not minted − `SelfBurnExecuted` / `Top10Buy`. Those protocol events are attribution only. Not claimed ≡ between reconciles.
- Material stale or degraded quote USD **pauses the epoch**. Never guess a mark. Never invent a 0.30% hookless pool.
- Web `/api/reactor/top10` **proxies** the indexer snapshot. Keeper and the public Reactor page consume that same payload.
- Keeper executes the **frozen onchain epoch**, not a later API refresh.
- Contracts check structure only. Compromised ranks are residual risk #1.

See [Trust](/docs/trust), [Valuation](/docs/valuation), `KEEPER_MODEL.md`.
