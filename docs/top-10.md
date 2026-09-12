# Top-10

> 1% of official quote-side volume funds THE REACTOR. Ranks are an **offchain API**. Contracts check structure only. Not a trustless oracle.

THE REACTOR UI is `/reactor`. It shows indexer ranks plus onchain epoch events. A compromised indexer or job signer can submit a legal-looking epoch that is economically wrong. Relayers / CRE cannot substitute ranking. That is residual risk **#1**. See [Trust](/docs/trust).

Canonical compute is indexer `ValuationService` + persisted markets (`GET /top10`). Schema **v11** stores `top10_candidate_epochs` / `top10_candidate_rows`. Web `/api/reactor/top10` **proxies** that snapshot. The job signer and the public Reactor page consume the same payload (`valuationSnapshotHash` is bound onchain). Relayers / CRE cannot substitute ranking. Not a per-request Factory RPC. Serve and Keeper share `TOP10_SNAPSHOT_TTL_SEC` (15 minutes).

Live UI: a bottom-right toast appears when `Top10Buy` is committed (SSE `burn` + `eventKind=Top10Buy`). Two same-tx logs at different `logIndex` values are two notices. `EpochSubmitted` updates THE REACTOR table; it is not a buy+burn confirm. Ranks stay offchain.

## Who is eligible (API, not the contract)

- Graduated REACTOR token (Instant `graduate` or Fair finalize)
- **Not CORE** (excluded in the data plane and onchain)
- Operational mark ≳ **$250k**
- Nested quote USD resolved by [ValuationService](/docs/valuation) ancestry (CAT → ZCAT → ZEC → USD)
- Circulating inventory is persisted `tokens.current_supply` (schema **v9**) — remaining onchain `totalSupply()` after token-level `burn()`, not TokenCreated `tokens.supply`, not minted − `SelfBurnExecuted` / `Top10Buy`. After v9, empty `current_supply` on a graduated non-CORE name **pauses the epoch** — no mint-supply fallback.
- Indexed liquidity is `graduations.quote_lp` (else `markets.real_quote`) valued through ValuationService. Never `lastGoodMark / 5`. An unvalued graduate with liquidity ≥ floor/5 pauses.
- Ungraduated Instant names are not eligible (start FDV is not a rank input)

12-minute VWAP on indexed official trades. External spots do not control the official mark unless they are an accepted, fresh consensus `external_price_marks` row.

If a **material** mark is unreliable the API **pauses the epoch** — it never guesses. Never invent a 0.30% hookless pool. Irrelevant inactivity (dead low-value graduates, fewer than 3 trades) is skipped, not a global freeze.

`material` means prior ranked, last-good ≥ floor, **indexed** liquidity ≥ floor/5, or window volume. Thousands of dead names do not freeze the board.

A persisted snapshot is served only while `now − computedTs ≤ TOP10_SNAPSHOT_TTL_SEC`. Past that TTL the handler refreshes; a failed refresh returns `pauseEpoch` and empty rows — never the last healthy payload. Ingest `tick()` persist-on-fail replaces the last healthy row with a paused snapshot.

## What the contract checks

The Keeper publishes `epochId + targets + weights` from the frozen `GET /top10` snapshot. Onchain `submitEpoch` checks **structure only**:

- Real graduated REACTOR tokens
- Not CORE (rejected even if included)
- No duplicates
- ≤ 10 names
- Weights valid; sum **100%** (10_000 bps) if there is at least one member
- Epoch not already finalized

It does **not** verify market caps, VWAP, or USD. `#11` is never submitted and receives zero.

If fewer than 10 eligible, the full pot splits among them. If 0, the pot accumulates.

Each ranked name is paid `epochPot * weight / weightSum` (pot snapshotted at `submitEpoch`). A later exec cannot shrink an earlier share.

## Execution

Keeper jobs execute the **frozen onchain epoch**, not a later API refresh. The daemon reads the same indexer `GET /top10` snapshot the public route proxies. Accept uses `acceptTop10Snapshot`: `pauseEpoch` **or** `computedTs` older than the TTL refuses submit. Each Top-10 buy takes a **20% chunk** + cooldown and a Keeper-supplied `minOut` from the **fee-exempt** planner. `bought[epoch][token]` is set before the swap so a buy that itself pays 3.5% does not recurse the same slot.

Official edges on maintenance tickets appear in `exemptOfficialLegs[]` (0 user fee), never as charged `feeLegs[]`.

## Valuation used for ranks

- ValuationService USD marks (12m VWAP window + nested quotes)
- External spots do not control the mark unless they are accepted, fresh consensus
- A rejected / missing consensus on the quote fails closed for **material** candidates
- Burn-adjusted remaining supply (`tokens.current_supply`) is the FDV inventory — not the initial 1B mint
- Rank reads the **persisted** `current_supply` snapshot, not a live `totalSupply()` RPC during rank

`GET /valuation?token=` remains the per-asset USD probe. `GET /top10` is the official rank snapshot.

## What was retired

These are gone and must not return in V1 docs:

- Permissionless keepers
- USDC bounties / `KeeperReserve`
- Onchain TWAP / Pyth / Chainlink Top-10 valuation trees
- Public settle farming
- Web `discoverTop10` Factory RPC walk
- Assumed hookless 0.30% quote/USDC fallback

Continue: [Valuation](/docs/valuation) · [Keeper](/docs/keeper) · [Economics](/docs/economics) · `KEEPER_MODEL.md`.
