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

The indexer computes ranks and weights offchain about every five minutes (`GET /top10`). Web `/api/reactor/top10` is a proxy of that persisted snapshot. The Keeper consumes the same payload — it does not walk Factory tokens or invent marks.

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
- v4 hops: hookless or official REACTOR hook only (`UniswapV4Adapter` user fees; `ProtocolV4Adapter` protocol-exempt)
- No cross-bucket spend
- Reentrancy lock
- ≤ 3 hops, no cycles, no duplicate assets
- Cooldown / 20% chunk (`MAX_CHUNK_BPS`) / no replay of the same Top-10 slot
- Keeper supplies `minTargetOut` / per-hop `minOut` — **never** hardcoded 1 or 0 on maintenance buys
- User SELL floors (`minQuoteOut` / `minFinalOut`) are **not** Keeper jobs. They come from the selected `PreviewedRoute` (`splitPreviewRoute.terminalOut` + final USDC), never from launch-token `amountIn`.

Daemon: `apps/indexer/src/keeper.ts` — SelfBurn, Flywheel settle, CORE settle, epoch publish, Top-10 exec, CORE burn, optional graduate assist. Simulate → minOut → submit → receipt → reconcile. Idempotent job IDs. Modes `DRY_RUN` / `LOCAL` / `ARC_TESTNET`. Mainnet 5042 disabled. Ambiguous RPC does not double-exec.

Leadership is a single `leader_locks` lease (not `pg_advisory_lock`). `ts` and `lease_until` are wall-clock **milliseconds** (`Date.now()` + TTL), `BIGINT` on Postgres (schema v6). Job `keeper_operations.ts` is the same unit. Do not store unix seconds in those columns.

Default TTL is ~50s and **shorter than possible tick work**, so a live leader must renew `lease_until` (default every 15s, and immediately before each broadcast) while keeping the acquire-generation fence (`ts`) fixed. A standby that acquires after expiry gets a new fence; the previous owner cannot renew or send. That is the split-brain fence — see `/docs/keeper` Operations. Production concurrency is proven with **two independent Postgres pools** (`test:pg-lease`). `apps/indexer/src/watchdog.ts` is an independent fail-closed process.

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
