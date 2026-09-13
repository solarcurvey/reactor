# Automation gateway

> `AutomationGateway` is `ReactorGuardian.keeper` on this draft. Relayers have no ranking, route, or floor authority. See [Keeper](/docs/keeper).

Maintenance is **not** a privileged EOA calling vaults. `AutomationGateway` is `ReactorGuardian.keeper`. Relayers (Chainlink CRE, Gelato, a standby wallet, anyone) only **deliver** a short-lived EIP-712 `MaintenanceJob`. They have no ranking, route, or floor authority.
## Four roles (do not collapse)

| Role | What it does | What it cannot do |
| --- | --- | --- |
| **Decision service** | Indexer ValuationService + `GET /top10` + `/pricing/health` + fee-exempt route sim | Write onchain. Guess a mark. Change 2/1/0.5 |
| **Auth signer** | `AutomationGateway.jobSigner` — signs the exact job (action, payload hash, hops, minOut, amount, snapshot) | Call vaults. The signer key is not `keeper` |
| **Relayer** | Submits a signed job (CRE / Gelato / daemon / any EOA) | Change targets, hops, minOut, or amount. First valid consume wins |
| **Guardian** | Pause gateway or Keeper, rotate `jobSigner`, replace `keeper` with a new gateway | Rank Top-10, withdraw LP, rewrite fees |

CRE does **not** decentralize Top-10 ranking. Ranks remain trusted offchain computation. CRE (when used) is a courier of an already-signed job.

## Typed entrypoints only

Inventory (action id is the signed `MaintenanceJob.action`):

| ID | Job | Gateway entry | Vault | Foundry |
| --- | --- | --- | --- | --- |
| 0 | SelfBurn | `executeSelfBurn` | `SelfBurnVault.execute` | `test_selfBurnHappyPathAndDirectKeeperBlocked` |
| 1 | Flywheel settle | `settleQuote` | `FlywheelVault.settleQuote` | `test_settleQuoteBindsAmountAndHops` |
| 2 | Submit epoch | `submitEpoch` | `FlywheelVault.submitEpoch` | `test_submitEpochBindsValuationSnapshot` |
| 3 | Top-10 buy+burn | `executeTop10Buyback` | `FlywheelVault.executeTop10Buyback` | `test_top10ThenRollThroughGateway` |
| 4 | Roll epoch | `rollEpoch` | `FlywheelVault.rollEpoch` | `test_top10ThenRollThroughGateway` |
| 5 | CORE buyback | `executeBuyback` | `BuybackVault.execute` | `test_buybackThroughGateway` |

There is no generic `target.call(calldata)`. `onReport` decodes the same `MaintenanceJob` + typed args for CRE-native report delivery. Unknown `action` is `UnknownAction`. Calling the wrong typed entrypoint for a signed action is `WrongAction`.
`InstantCurve.graduate` is **permissionless** and is **not** a gateway job.

## Job bind

EIP-712 domain `REACTOR.AutomationGateway` / `1` / `chainId` / gateway. Struct: `gateway, chainId, action, payloadHash, jobId, validAfter, deadline, snapshotHash`. The **signed** interval `deadline - validAfter` must be ≤ 30 minutes (`BadWindow` if inverted or longer). Remaining time at execution is not the TTL bound — an old leaked `validAfter` plus a near-future deadline cannot execute. `now` must still fall in `[validAfter, deadline]`. `jobId` consume is first-wins; dual-relayer races are `Replay` after the first success.
`submitEpoch` binds ValuationService targets/weights + `valuationSnapshotHash` + `/pricing/health`. Relayers cannot substitute ranking.

Route jobs bind exact hops / `minOut` / amount (the vault’s current chunk). Weakening a floor invalidates the digest.

## Dual-relayer failover (recorded)

Two recorded proofs, same `MaintenanceJob` format:

1. **Onchain semantics (Foundry).** Relayer A consumes; relayer B is `Replay` and does not move the pot. Evidence: `ops/cre/simulation/failover-rehearsal.json` (written by `MaintenanceFailover.t.sol`). `scripts/maintenance-failover.ts` always re-runs that Foundry test.
2. **Autonomous production-shaped path (deployed Gateway).** A signer HTTP service produces and EIP-712-signs jobs (never broadcasts). Relayer A and relayer B are **separate processes and EOAs**. Two recorded outcomes: **failover liveness** (A and B start together; A’s submit RPC is down so it fails before consume; B still consumes — B does not wait for A=`consumed`) and **race idempotency** (both submit; exactly one `JobConsumed`, the other is `Replay`). Evidence: `ops/cre/simulation/autonomous-relay-failover.json`. Script: `scripts/autonomous-relay-failover.ts`. Default target is a Gateway from `Deploy.s.sol` on local Anvil 5042002. That is not a claimed Arc Public Testnet address and not 5042.

After #73 those proofs run on `.github/workflows/ci.yml`: fast+Solidity `foundry-targeted` `forge test` covers the Foundry contracts; full/main `solidity + size-guard` also re-runs both rehearsal scripts. The indexer unit suite does not spawn `forge` or `anvil`. Encode-only calldata identity is not that proof. See [CI and cost](/docs/ci).

The #51 CRE simulator AC is **not closed**. Authenticated `cre workflow simulate` on catalog 1883 still needs a CRE tenant. Official `cre workflow build` (CLI v1.33.0, no tenant) compiled the signed-job courier to WASM — `ops/cre/simulation/cre-workflow-build.json`. That compile is **not** a `Workflow Simulation Result`. See `ops/cre/simulation/cre-tenant-blocker.json`.

Not a live CRE DON. Not claimed Arc Public Testnet. Not Arc Mainnet 5042. No human or AI click in the autonomous loop.

See `KEEPER_MODEL.md`, [Keeper](/docs/keeper), [Trust](/docs/trust), `ops/cre/README.md`, `INCIDENT_RESPONSE.md`.
