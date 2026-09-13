# Automation gateway

> **Not on current `main`.** This page describes draft **#54** (`AutomationGateway` + signed `MaintenanceJob`). Current `main` uses a designated Keeper daemon with an onchain `keeper` role. See [Keeper](/docs/keeper).

Maintenance is **not** a privileged EOA calling vaults. When **#54** lands, `AutomationGateway` becomes `ReactorGuardian.keeper`. Relayers (Chainlink CRE, Gelato, a standby wallet, anyone) only **deliver** a short-lived EIP-712 `MaintenanceJob`. They have no ranking, route, or floor authority.

## Four roles (do not collapse)

| Role | What it does | What it cannot do |
| --- | --- | --- |
| **Decision service** | Indexer ValuationService + `GET /top10` + `/pricing/health` + fee-exempt route sim | Write onchain. Guess a mark. Change 2/1/0.5 |
| **Auth signer** | `AutomationGateway.jobSigner` — signs the exact job (action, payload hash, hops, minOut, amount, snapshot) | Call vaults. The signer key is not `keeper` |
| **Relayer** | Submits a signed job (CRE / Gelato / daemon / any EOA) | Change targets, hops, minOut, or amount. First valid consume wins |
| **Guardian** | Pause gateway or Keeper, rotate `jobSigner`, replace `keeper` with a new gateway | Rank Top-10, withdraw LP, rewrite fees |

CRE does **not** decentralize Top-10 ranking. Ranks remain trusted offchain computation. CRE (when used) is a courier of an already-signed job.

## Typed entrypoints only

`SelfBurnVault.execute`, `FlywheelVault.settleQuote` / `submitEpoch` / `executeTop10Buyback` / `rollEpoch`, `BuybackVault.execute`.

There is no generic `target.call(calldata)`. `onReport` decodes the same `MaintenanceJob` + typed args for CRE-native report delivery.

`InstantCurve.graduate` is **permissionless** and is **not** a gateway job.

## Job bind

EIP-712 domain `REACTOR.AutomationGateway` / `1` / `chainId` / gateway. Struct: `gateway, chainId, action, payloadHash, jobId, validAfter, deadline, snapshotHash`. TTL ≤ 30 minutes. `jobId` consume is first-wins; dual-relayer races are `Replay` after the first success.

`submitEpoch` binds ValuationService targets/weights + `valuationSnapshotHash` + `/pricing/health`. Relayers cannot substitute ranking.

Route jobs bind exact hops / `minOut` / amount (the vault’s current chunk). Weakening a floor invalidates the digest.

See `KEEPER_MODEL.md`, [Keeper](/docs/keeper), [Trust](/docs/trust), `ops/cre/README.md`.
