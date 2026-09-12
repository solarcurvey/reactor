# Top-10

1% of official quote-side volume funds THE REACTOR. Ranks are an **offchain API**.

- Canonical compute: indexer `ValuationService` + persisted markets (`GET /top10`). Schema **v11** stores `top10_candidate_epochs` / `top10_candidate_rows`.
- 12-minute VWAP on indexed official trades. Nested quotes walk ValuationService ancestry (CAT → ZCAT → ZEC → USD). External spots do not control the official mark unless they are an accepted, fresh consensus `external_price_marks` row.
- Floor $250k. CORE excluded in the data plane and onchain. ≤10 names, weights 100%.
- Circulating supply is persisted `tokens.current_supply` (schema **v9**), which tracks remaining onchain `totalSupply()` (token-level `Burned` / Transfer-to-zero + bounded reconcile). Not TokenCreated `tokens.supply` and not minted − `SelfBurnExecuted` / `Top10Buy`. Those protocol events are attribution only. After v9, a graduated non-CORE name with empty `current_supply` **pauses the epoch** — no mint-supply fallback.
- Indexed liquidity is `graduations.quote_lp` (else `markets.real_quote`) valued through ValuationService. Never `lastGoodMark / 5`. An unvalued graduate with liquidity ≥ floor/5 pauses (independent liquidity arm of the frozen material-uncertainty rules).
- Persisted snapshots have a bounded TTL (`TOP10_SNAPSHOT_TTL_SEC` = 15 minutes), shared by `GET /top10` and Keeper. A stale healthy payload is not served: refresh is attempted; if refresh fails the API pauses and Keeper refuses. Ingest `tick()` persist-on-fail replaces the last healthy row with a paused snapshot.
- Material stale or degraded quote USD **pauses the epoch**. Never guess a mark. Never invent a 0.30% hookless pool.
- Web `/api/reactor/top10` **proxies** the indexer snapshot. Keeper and the public Reactor page consume that same payload.
- Keeper executes the **frozen onchain epoch**, not a later API refresh. It refuses `pauseEpoch` **or** a snapshot whose `computedTs` is older than the TTL.
- Contracts check structure only. Compromised ranks are residual risk #1.

Live UI: a bottom-right toast appears when `Top10Buy` is committed (SSE `burn` + `name=Top10Buy`). `EpochSubmitted` updates THE REACTOR table; it is not a buy+burn confirm. Ranks stay offchain.

See [Trust](/docs/trust), [Valuation](/docs/valuation), `KEEPER_MODEL.md`.
