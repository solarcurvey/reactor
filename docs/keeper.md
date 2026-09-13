# Keeper

> Onchain Keeper is `AutomationGateway`. Relayers deliver signed jobs. Not permissionless. Not a bounty. Not Guardian. CRE does not rank Top-10. Mainnet **5042 is disabled**.

See [Automation](/docs/automation). Maintenance is not a privileged EOA calling vaults. There is no `KeeperReserve`, no public settle farming, and no onchain TWAP/Pyth Top-10. Source: `KEEPER_MODEL.md`.

## Jobs

The Keeper (and only the Keeper, and only while not paused) may:

1. Flywheel quote → USDC (`FlywheelVault.settleQuote`)
2. Submit a Top-10 epoch (`submitEpoch`)
3. Top-10 buy+burn (`executeTop10Buyback`)
4. Roll the epoch (`rollEpoch`)
5. CORE quote → CORE buy+burn (`BuybackVault.execute`)
6. Standard SelfBurn (`SelfBurnVault.execute`)

The Keeper is **not** an owner. It cannot configure quotes, adapters, fees, Guardian, or vault recipients. It cannot withdraw.

Each job takes a **20% chunk** (`MAX_CHUNK_BPS = 2000`) + `KEEPER_COOLDOWN = 5 minutes`. Last-sweep: if leftover after chunk is below threshold, take remaining so pots can drain. The Keeper supplies `minOut` from a **whole-route, fee-exempt** preview (`planFeeExemptRoute` + ProtocolV4Adapter). That path never shares `UserRouteQuoter`. Official edges are listed on the ticket as `exemptOfficialLegs[]` (0 user fee). Successful quotes refuse `minOut` 0 or 1.

Top-10 jobs execute the **frozen onchain epoch**, not a later API refresh. The daemon reads the same indexer `GET /top10` snapshot the public route proxies. Accept uses `acceptTop10Snapshot`: `pauseEpoch` **or** `computedTs` older than `TOP10_SNAPSHOT_TTL_SEC` (15 minutes) refuses submit. A stalled ranker cannot keep a stale healthy payload live. See [Top-10](/docs/top-10).

`submitOnce` — if the RPC is ambiguous (timeout after broadcast), do not resubmit.

Dual relayers of the same signed `jobId` are first-wins on `AutomationGateway`. The second is `Replay` and does not move pots. Local-forge evidence: `ops/cre/simulation/failover-rehearsal.json` via `scripts/maintenance-failover.ts`. Autonomous deployed-Gateway evidence (signer service + failover liveness + simultaneous race, no AI): `ops/cre/simulation/autonomous-relay-failover.json` via `scripts/autonomous-relay-failover.ts`. Those rehearsals are Gateway consume/Replay proofs. Production KMS authorizer + dual managed relays live in **#83**. Authenticated CRE simulate is optional interoperability, not the production path.

## Leadership

**One** mechanism: `leader_locks`. Acquire is `UPDATE … RETURNING` (Postgres) or a Store transaction (`BEGIN IMMEDIATE` on SQLite). Do not mix this with `pg_advisory_lock` as a second leader.

The ~50s TTL (`KEEPER_LEASE_TTL_MS`, default 50_000) is a **dead-leader failover**, not a work budget. A tick can run longer than that (`waitForTransactionReceipt` timeout is 60s; discovery/sim loops scale with markets). A live leader **renews** `lease_until` on an interval (`KEEPER_LEASE_RENEW_MS`, default 15_000) and again immediately before every broadcast. Renew keeps the acquire-generation fence (`leader_locks.ts`) unchanged. Each acquire mints a **monotonic** fence (`max(now, prev.ts+1)`) so two acquires in the same millisecond are still distinct generations.

Production still uses `Date.now()` + `setInterval`. Unit / `test:pg-lease` TTL cases inject that clock (`lease-clock.ts` / `lease-clock.fake.ts`) so “work > TTL while renewing” does not race the event loop under CI load. Lease SQL and fence rules are unchanged.

If renew fails (expiry without renewal, or another owner stole after expiry) the process **refuses to send**. It does not re-acquire mid-tick. The next loop may become leader. That is the split-brain fence.

## Operations

| Concern | Rule |
| --- | --- |
| Overlapping daemons | Only the row owner+fence may send. Standby writes `standby — not leader` and does not broadcast. |
| Long tick | Background renew + pre-send renew. Do not raise TTL to “cover” work; that delays failover. |
| Lost lease mid-tick | Fail closed for further jobs. Heartbeat reason `leader lease lost — refuse broadcast`. Not a protocol pause. |
| Release | `DELETE … owner AND ts=fence` so a stale finally cannot drop a newer generation. |
| Watchdog | Independent process. Separate keys. Checks heartbeat + on-chain epoch, not this lease row. |
| Two workers | Production proof is **two independent Postgres pools**, not one SQLite `Store`. `pnpm --filter indexer test:pg-lease` (CI job `postgres-ms-timestamps` on full/main). Simultaneous acquire has one winner; a renewing leader cannot be overlapped; expiry/crash lets the standby take a new fence; the stale generation cannot renew, drop the new row, or send. AC1 uses real `Date.now()` (BIGINT ms). Renew / expiry ACs drive an injected clock. |

`leader_locks.ts`, `leader_locks.lease_until`, and `keeper_operations.ts` are **milliseconds** (`Date.now()` / `Date.now() + ttlMs`), `BIGINT` on Postgres. On-chain Keeper work still uses `block.timestamp` seconds. A 32-bit INTEGER column overflows today's `Date.now()` (~1.8e12).

## Modes

| Mode | Meaning |
| --- | --- |
| `LOCAL` | Anvil 5042002 |
| `DRY_RUN` | Simulate only |
| `ARC_TESTNET` | Chain 5042002 public RPC |

Arc Mainnet **5042 is disabled** in Keeper and deploy scripts.

Daemon: `apps/indexer/src/keeper.ts`. Independent `watchdog` (`apps/indexer/src/watchdog.ts`) fail-closes on stale heartbeat / pause. Monitoring keys must be **separate** from the Keeper.

## Trust — operational risk

`route` and `minOut` are **operational** risk on the Keeper key and its simulator.

A compromised Keeper key can waste a pot on a bad already-bound route (sandwich / poor `minOut`) within chunk/hop/bucket bounds. It cannot redirect pots to itself, change fees, or empty official LP. Guardian can pause Keeper or replace `keeper` immediately. Signed-job relayer isolation is draft **#54**, not this tree.

## Retired

These are gone and must not return in V1 docs:

- Permissionless keepers
- USDC bounties / `KeeperReserve`
- Onchain TWAP / Pyth / Chainlink Top-10 valuation trees
- Public settle farming

See [Automation](/docs/automation), [Trust](/docs/trust), [Quoting](/docs/quoting), `KEEPER_MODEL.md`.
