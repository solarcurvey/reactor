# KEEPER MODEL

Maintenance is **not** permissionless. A single designated REACTOR Keeper (backend-controlled address) runs every maintenance job. There is no bounty, no `KeeperReserve`, no public settle farming.

## Jobs

The Keeper (and only the Keeper, and only while not paused) may:

1. Flywheel quote → USDC (`FlywheelVault.settleQuote`)
2. Submit a Top-10 epoch (`submitEpoch`)
3. Top-10 buy+burn (`executeTop10Buyback`)
4. Roll the epoch (`rollEpoch`)
5. CORE quote → CORE buy+burn (`BuybackVault.execute`)
6. Standard SelfBurn (`SelfBurnVault.execute`)

The Keeper is **not** an owner. It cannot configure quotes, adapters, fees, Guardian, or vault recipients. It cannot withdraw.

## Top-10

REACTOR API computes ranks and weights offchain about every five minutes.

Eligibility (API, not the contract):

- Graduated REACTOR token
- Not CORE
- Operational mark ≳ $250k
- Nested quote USD resolved offchain
- If a mark is unreliable: **skip that token or pause the epoch — never guess**

The Keeper publishes `epochId + targets + weights`. The contract checks **structure only**:

- Real graduated REACTOR tokens
- Not CORE
- No duplicates
- ≤ 10
- Weights valid; sum 100% (10_000 bps) if there is at least one member
- Epoch not already finalized

Then it emits `EpochSubmitted` and the Keeper executes buybacks. Contracts do **not** verify market caps. THE REACTOR UI reads API ranks plus these onchain events. Do not describe this as a trustless oracle.

## Routing

Routes are dynamic through Guardian-approved adapters (Uniswap v4 now; v3 / future later). There is no hardcoded path matrix and no generic `call` + calldata with vault approvals.

Guardrails:

- `tokenIn` / amount from the calling vault’s bucket
- `tokenOut` from the operation (USDC for settle, CORE for CORE buy, official quote then token for Top-10)
- Recipient is the vault (then burn, for buybacks)
- Adapter must be approved
- **Real balance deltas** per hop; next hop uses actual out (lying adapters fail)
- v4 hops: hookless, official REACTOR hook, or Guardian-approved hooks only
- No cross-bucket spend
- Reentrancy lock
- ≤ 3 hops, no cycles, no duplicate assets
- Cooldown / 20% chunk (`MAX_CHUNK_BPS`) / no replay of the same Top-10 slot
- Keeper supplies `minTargetOut` / per-hop `minOut` — **never** hardcoded 1 or 0 on maintenance buys

Daemon: `apps/indexer/src/keeper.ts` polls `/api/reactor/top10` (on-chain discovery, not env JSON) and writes a heartbeat. It does **not** broadcast in this repo. `apps/indexer/src/watchdog.ts` is an independent fail-closed process on a separate heartbeat file.

Fee exemption is only via the sealed executor contracts (SelfBurn, Flywheel, Buyback) calling `protocolSwap` / `buyExempt`. The Keeper EOA is never allowlisted.

## Trust — operational risk

`route` and `minOut` are **operational** risk on the Keeper key and its simulator.

Mitigations:

- Simulate hops and bound size before sending
- Monitor fills and adapter allowlist
- Per-op / epoch limits; cannot spend holder Rewards or another token’s SelfBurn
- Guardian can pause or replace the Keeper immediately

A compromised Keeper can waste a pot on a bad route (sandwich / poor `minOut`) within those bounds. It cannot redirect pots to itself, change fees, or empty official LP.

Monitoring / watchdog processes must use **separate** keys from the Keeper.

## Retired

These are gone and must not return in V1 docs:

- Permissionless keepers
- USDC bounties / `KeeperReserve`
- Onchain TWAP / Pyth / Chainlink Top-10 valuation trees
- Public settle farming
