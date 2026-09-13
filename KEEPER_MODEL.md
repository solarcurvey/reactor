# KEEPER MODEL

Maintenance is **not** permissionless. `ReactorGuardian.keeper` is the onchain `AutomationGateway`. Relayers (Chainlink CRE, Gelato, a standby wallet, anyone) only deliver a short-lived EIP-712 `MaintenanceJob`. They have **no decision authority**. There is no bounty, no `KeeperReserve`, no public settle farming.

**Roles — do not collapse:** the **decision service** (ValuationService + route sim + `/pricing/health`) chooses ranks and floors; the **auth signer** (`gateway.jobSigner`) signs that exact job; the **relayer** submits it; **Guardian** pauses / rotates. CRE does **not** decentralize Top-10 ranking. Authenticated `cre workflow simulate` on catalog 1883 is a remaining #51 external blocker (`ops/cre/simulation/cre-tenant-blocker.json`) — not a live DON and not 5042.

## Jobs

The gateway (and only the gateway, and only while not paused) may:

| ID | Job | Gateway | Vault |
| --- | --- | --- | --- |
| 0 | SelfBurn | `executeSelfBurn` | `SelfBurnVault.execute` |
| 1 | Flywheel quote → USDC | `settleQuote` | `FlywheelVault.settleQuote` |
| 2 | Submit Top-10 epoch | `submitEpoch` | `FlywheelVault.submitEpoch` |
| 3 | Top-10 buy+burn | `executeTop10Buyback` | `FlywheelVault.executeTop10Buyback` |
| 4 | Roll epoch | `rollEpoch` | `FlywheelVault.rollEpoch` |
| 5 | CORE quote → CORE buy+burn | `executeBuyback` | `BuybackVault.execute` |

Canonical table + test names: [Automation](/docs/automation).

The Keeper is **not** an owner. It cannot configure quotes, adapters, fees, Guardian, or vault recipients. It cannot withdraw.

## Top-10

Indexer `GET /top10` computes ranks and weights from ValuationService + persisted `current_supply`. Keeper and the public web route consume that snapshot and share `TOP10_SNAPSHOT_TTL_SEC` (15 minutes). A stale or paused payload is refused — the daemon does not submit the last healthy ranks after the ranker stalls.

Eligibility (API, not the contract):

- Graduated REACTOR token
- Not CORE
- Operational mark ≳ $250k
- Nested quote USD resolved offchain
- If a mark is unreliable: **skip that token or pause the epoch — never guess**

The decision service publishes `epochId + targets + weights` bound to `valuationSnapshotHash` + pricing-health. Relayers cannot substitute ranking. The flywheel contract still checks **structure only**:

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
- `POST /quote` maintenance kinds report official edges in `exemptOfficialLegs[]` (0 user fee) — never as charged `feeLegs[]`. User tickets bind `feeLegs[]` to the `pickBest` winner only.

Daemon: `apps/indexer/src/keeper.ts` — decision + **job signer**. Simulate as the gateway → conservative minOut → sign `MaintenanceJob` (exact hops / minOut / amount / snapshot) → any relayer submits to `AutomationGateway`. Optional permissionless `graduate` assist (not a gateway job). Idempotent job IDs. Modes `DRY_RUN` / `LOCAL` / `ARC_TESTNET`. Mainnet 5042 disabled. Ambiguous RPC does not double-exec. Signing and broadcast sit inside the same `leader_locks` fence (`withSignAndBroadcastFence`).

Leadership is a single `leader_locks` lease (not `pg_advisory_lock`). `ts` and `lease_until` are wall-clock **milliseconds** (`Date.now()` + TTL), `BIGINT` on Postgres (schema v6). Job `keeper_operations.ts` is the same unit. Do not store unix seconds in those columns.

Default TTL is ~50s and **shorter than possible tick work**, so a live leader must renew `lease_until` (default every 15s, and immediately before each broadcast) while keeping the acquire-generation fence (`ts`) fixed. A standby that acquires after expiry gets a new fence; the previous owner cannot renew or send. That is the split-brain fence — see `/docs/keeper` Operations. Production concurrency is proven with **two independent Postgres pools** (`test:pg-lease`). SQLite unit + pg-lease TTL cases inject the lease clock so CI does not race `setInterval` against a 400ms TTL; production still uses `Date.now()` + `setInterval`. `apps/indexer/src/watchdog.ts` is an independent fail-closed process.

Fee exemption is only via the sealed executor contracts (SelfBurn, Flywheel, Buyback) calling `protocolSwap` / `buyExempt`. The job signer EOA and relayer EOAs are never allowlisted. The gateway is `keeper` so vault `onlyKeeper` sees the gateway, not the courier.

## Trust — operational risk

`route` and `minOut` are **operational** risk on the **job signer** and its simulator. A compromised relayer cannot weaken floors or swap Top-10 members. Dual-relayer races are first-valid-consume; the loser is `Replay` (local-forge evidence: `ops/cre/simulation/failover-rehearsal.json`; autonomous deployed-Gateway evidence: `ops/cre/simulation/autonomous-relay-failover.json`). Authenticated CRE simulate remains an external blocker: `ops/cre/simulation/cre-tenant-blocker.json`.

Mitigations:

- Simulate hops and bound size before sending
- Monitor fills and adapter allowlist
- Per-op / epoch limits; cannot spend holder Rewards or another token’s SelfBurn
- Guardian can pause or replace the Keeper immediately

A compromised **job signer** can waste a pot on a bad signed route (sandwich / poor `minOut`) within those bounds. It cannot redirect pots to itself, change fees, or empty official LP. Guardian can pause the gateway or rotate the signer immediately.

Monitoring / watchdog processes must use **separate** keys from the job signer. In PROD the relayer key must also be distinct. See `INCIDENT_RESPONSE.md` and `/docs/automation`.

## Retired

These are gone and must not return in V1 docs:

- Permissionless keepers
- USDC bounties / `KeeperReserve`
- Onchain TWAP / Pyth / Chainlink Top-10 valuation trees
- Public settle farming
