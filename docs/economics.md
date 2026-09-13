# Economics

> Official LP fee is **0%**. Protocol charge is **3.5%** of executed gross quote: **2% holders / 1% Top-10 / 0.5% CORE**. Factory **V1**. Not audited.

Official REACTOR pool only. External / hookless pools have no protocol charge. Economics attach to the official market, not the ERC-20.

V1 swaps are **exact-in**. Incomplete fills revert. Fee is always **quote-side**. There is **no** creator fee, platform cash fee, creation fee, transfer tax, or token-level sell tax.

CI (`pnpm docs:check`) fails if this page drifts from `ReactorConstants`. Source: `ECONOMICS.md`.

## The 3.5% split

| Item | Value |
| --- | --- |
| Native Uniswap LP fee | **0%** |
| REACTOR economic fee | **3.5% of actual quote notional** (350 bps) |
| Holders | **2.00%** (200 bps) same quote, never converted |
| Top-10 flywheel | **1.00%** (100 bps) async `FlywheelVault` |
| CORE buy + burn | **0.50%** (50 bps) on non-CORE markets |
| Official CORE/USDC | **2.50%** buy+burn + **1%** flywheel (no holder 2%) |
| Creator / treasury / referral / creation | **0** |
| Transfer tax | **0** |

A different split is Factory **V2**, not a parameter on V1.

## Worked $1,000 official trade

On a single official hop: **$20** holders (quote) · **$10** flywheel · **$5** CORE. Not an LP fee.

Nested official hops each take 3.5% of **that hop’s quote notional**. Two sequential 3.5% legs compound to **6.88%** (`1 − 0.965²`) before slippage — listed separately on `POST /quote` as `aggregateProtocolImpactBps = 688`. The UI shows each leg in that hop’s quote (ZEC-8 vs ZCAT-18 are not summed). Hookless hops are not a REACTOR charge. Keeper / protocol routes are fee-exempt.

## When the 2% is not holders

| Situation | 2% destination |
| --- | --- |
| Rewards, `eligibleSupply > 0` | Holders, same quote |
| Rewards, `eligibleSupply == 0` | **SelfBurn** (not the first holder) |
| Standard | **SelfBurn** (later market-buy + burn) |
| Official CORE/USDC | **None** — consolidated into 2.5% CORE burn |

The first Instant buy always hits `eligibleSupply==0` because fees are booked **before** tokens are delivered.

## Instant / Fair inventory

Instant is **bonding curve → v4 graduation**, not single-sided permanent v4 from trade #1.

| Item | Value |
| --- | --- |
| Supply / decimals | Protocol: **1B / 18**. Creator cannot set. |
| Curve inventory | **79.31%** |
| v4 reserve | **20.69%** locked forever at graduation |
| Start FDV (USDC) | **~$5,000** (`CURVE_DESIGN.md`) |
| Graduation | Terminal buy → `ready` → **frozen** (no buy/sell) → permissionless `graduate` |
| Terminal fees | Applied only to **executed gross**; unexecuted + unearned fee is refunded |
| Dev buy | Optional, atomic `launchAndBuy`, full 3.5%, max **5%** supply by token out |
| Fair sale | **0%** REACTOR charge during bids; 3.5% after one migration |
| Fair lock | `auctionBps` locked **5000** (50/50) at clear |

See [Curve math](/docs/curve) and [Launch lifecycle](/docs/lifecycle).

## Flywheel / CORE (economic rules)

- CORE is never Top-10 eligible (contract-level).
- Instant starting FDV is not a rank input. Ungraduated Instant tokens are not Top-10 eligible.
- Top-10 ranks and weights are computed **offchain** by indexer `GET /top10` (ValuationService + persisted `current_supply`, schema **v11**). Operational floor **~$250k** on a defensible mark. If a **material** mark is unreliable the API pauses the epoch — it never guesses.
- The contract checks structure only (graduated REACTOR tokens, not CORE, no dupes, ≤10, weights sum 100% if ≥1). It does **not** verify market caps.
- If fewer than 10 eligible, the full pot splits among them. If 0, the pot accumulates.
- `#11` is never submitted and receives zero.
- There is no KeeperReserve and no bounty.

See [Top-10](/docs/top-10) and [CORE](/docs/core).

## What V1 will never charge

- Creator fee
- Platform cash fee
- Creation fee
- Transfer tax
- Token-level sell tax
- A second official CORE book
- Protocol fee quote seeded into graduation LP

Continue: [Fees](/docs/fees) · [Rewards](/docs/rewards) · [Curve](/docs/curve) · `ECONOMICS.md`.
