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

Each job takes a **20% chunk** (`MAX_CHUNK_BPS = 2000`) + `KEEPER_COOLDOWN = 5 minutes`. Last-sweep: if leftover after chunk is below threshold, take remaining so pots can drain. The decision service supplies `minOut` from a **whole-route, fee-exempt** preview (`planFeeExemptRoute` + ProtocolV4Adapter). That path never shares `UserRouteQuoter`. Official edges are listed on the ticket as `exemptOfficialLegs[]` (0 user fee). Successful quotes refuse `minOut` 0 or 1.

Top-10 jobs execute the **frozen onchain epoch**, not a later API refresh. The decision daemon reads the same indexer `GET /top10` snapshot the public route proxies. Accept uses `acceptTop10Snapshot`: `pauseEpoch` **or** `computedTs` older than `TOP10_SNAPSHOT_TTL_SEC` (15 minutes) refuses submit. A stalled ranker cannot keep a stale healthy payload live. See [Top-10](/docs/top-10).

A signed `MaintenanceJob` binds the exact action, amount, route/hops, floor, chain, Gateway, validity window, replay id, and relevant snapshot. Relay submission does not reopen those decisions.

Dual relayers of the same signed `jobId` are first-wins on `AutomationGateway`. The second is `Replay` and does not move pots. Local-forge evidence: `ops/cre/simulation/failover-rehearsal.json` via `scripts/maintenance-failover.ts`. Autonomous deployed-Gateway evidence (signer service + failover liveness + simultaneous race, no AI): `ops/cre/simulation/autonomous-relay-failover.json` via `scripts/autonomous-relay-failover.ts`. Those rehearsals are Gateway consume/Replay proofs. Production KMS authorizer + dual managed relays live in **#83**. Authenticated CRE simulate is optional interoperability, not the production path.

## AWS managed production executor (#83)

The production baseline separates the old Keeper daemon responsibilities into a trusted decision/authorization path and untrusted liveness relays:

`canonical decision service → AWS KMS MaintenanceJob signer → Relay A / Relay B → AutomationGateway`

- Authorizer, Relay A and Relay B each have a distinct AWS KMS `ECC_SECG_P256K1` key.
- Relay roles have `kms:Sign` only on their own transaction key. They can read the authorizer public key but cannot sign MaintenanceJobs.
- The authorizer does not hold a relay transaction key and never broadcasts.
- Relay A submits immediately after verification/simulation. Relay B is delayed (15 seconds by default), then checks `usedJob(jobId)` before spending gas.
- Each Lambda is single-concurrency and EventBridge retries are disabled; the next minute is the retry boundary.
- Ambiguous/reverted execution remains bounded by Gateway replay state; a relay never gets authority to mint a fresh job or weaken a floor.
- The managed production path refuses raw maintenance/relay private-key environment fallbacks.

`infra/aws-relay/README.md` is the concrete bootstrap/cutover runbook. `pnpm test:aws-relay` cross-checks the runtime EIP-712 digest against the canonical package, exercises DER → low-s EVM recovery, serializes a KMS-style EIP-1559 transaction, rejects tampering, and lints the IaC trust boundary.

Real AWS KMS/Testnet evidence is still required before #83 closes.

## Legacy decision-daemon leadership

The #54 transition code still has one internal decision/signer daemon for local/test rehearsals. Its database leadership rules prevent duplicate planning/signing while production #83 replaces raw signing/broadcast with KMS authorizer + managed relays.

**One** mechanism: `leader_locks`. Acquire is `UPDATE … RETURNING` (Postgres) or a Store transaction (`BEGIN IMMEDIATE` on SQLite). Do not mix this with `pg_advisory_lock` as a second leader.

The ~50s TTL (`KEEPER_LEASE_TTL_MS`, default 50_000) is a **dead-leader failover**, not a work budget. A tick can run longer than that. A live leader **renews** `lease_until` on an interval (`KEEPER_LEASE_RENEW_MS`, default 15_000) and again immediately before every fenced sign/broadcast in the rehearsal path. Renew keeps the acquire-generation fence (`leader_locks.ts`) unchanged. Each acquire mints a **monotonic** fence (`max(now, prev.ts+1)`) so two acquires in the same millisecond are still distinct generations.

Production still uses `Date.now()` + `setInterval` for that daemon. Unit / `test:pg-lease` TTL cases inject that clock (`lease-clock.ts` / `lease-clock.fake.ts`) so “work > TTL while renewing” does not race the event loop under CI load. Lease SQL and fence rules are unchanged.

If renew fails (expiry without renewal, or another owner stole after expiry) the process **refuses to sign/send**. It does not re-acquire mid-tick. The next loop may become leader. That is the split-brain fence.

## Operations

| Concern | Rule |
| --- | --- |
| Overlapping decision daemons | Only the row owner+fence may produce the rehearsed action. Standby writes `standby — not leader`. |
| Long tick | Background renew + pre-action renew. Do not raise TTL to “cover” work; that delays failover. |
| Lost lease mid-tick | Fail closed for further jobs. Heartbeat reason `leader lease lost — refuse broadcast`. Not a protocol pause. |
| Release | `DELETE … owner AND ts=fence` so a stale finally cannot drop a newer generation. |
| AWS Relay A overlap | Lambda reserved concurrency 1. |
| AWS Relay B overlap | Lambda reserved concurrency 1 + delayed `usedJob` check. |
| Scheduled AWS retry | Lambda async retry disabled; EventBridge next minute is retry boundary. |
| Watchdog | Independent process. Separate keys. Checks heartbeat + on-chain epoch, not this lease row. |
| Two DB workers | Production proof for the existing planner DB fence is **two independent Postgres pools**, not one SQLite `Store`. `pnpm --filter indexer test:pg-lease` (CI job `postgres-ms-timestamps` on full/main). |

`leader_locks.ts`, `leader_locks.lease_until`, and `keeper_operations.ts` are **milliseconds** (`Date.now()` / `Date.now() + ttlMs`), `BIGINT` on Postgres. On-chain Keeper work uses `block.timestamp` seconds. A 32-bit INTEGER column overflows today's `Date.now()` (~1.8e12).

## Modes

| Mode | Meaning |
| --- | --- |
| `LOCAL` | Anvil 5042002 |
| `DRY_RUN` | Simulate only |
| `ARC_TESTNET` | Current test/rehearsal target configured by deployment evidence |

Arc Mainnet **5042 is disabled** in the pre-production Keeper/deploy scripts.

Decision daemon: `apps/indexer/src/keeper.ts`. AWS relay runtime: `apps/indexer/src/aws-relay/`. Independent `watchdog` (`apps/indexer/src/watchdog.ts`) fail-closes on stale heartbeat / pause. Monitoring keys must be **separate** from the maintenance authorizer and relay keys.

## Trust — operational risk

The **maintenance authorization signer + canonical decision service** remain the trusted operational decision boundary. If either is compromised, it can authorize a bad-but-type-valid route/target within the underlying vault chunk/cooldown/threshold/reserve rules. This is why the maintenance signer is isolated in KMS and distinct from Guardian, pricing/launch signers and relays.

A compromised **relay** has liveness/gas risk only: it can submit or withhold already-signed jobs, but it cannot change Top-10 targets/weights, route, amount, `minOut`, snapshot, deadline, or fee economics. Guardian can pause the Gateway or rotate `jobSigner`.

## Retired

These are gone and must not return in V1 docs:

- Permissionless keepers
- USDC bounties / `KeeperReserve`
- Onchain TWAP / Pyth / Chainlink Top-10 valuation trees
- Public settle farming

See [Automation](/docs/automation), [Trust](/docs/trust), [Quoting](/docs/quoting), `KEEPER_MODEL.md`, `infra/aws-relay/README.md`.
