# Incident response — maintenance jobs

Not an audit. Not a runbook for stealing pots. Guardian is the brake pedal.

## Roles

| Role | Key / process | Rotate / halt |
| --- | --- | --- |
| Decision service | Indexer ValuationService, `GET /top10`, `/pricing/health` | Pause epoch (`pauseEpoch`) or take the API down. Do not guess marks |
| Auth signer | `JOB_SIGNER_PRIVATE_KEY` → `AutomationGateway.jobSigner` | Guardian `setJobSigner`. Old jobs fail `BadSigner` |
| Relayer | CRE / Gelato / `RELAYER_PRIVATE_KEY` / any courier | Ignore. A compromised relayer cannot steer a signed job |
| Guardian | Immutable Safe | `pauseGateway`, `pauseKeeper`, `setKeeper` (new gateway) |

Never reuse Guardian / job signer / pricing / launch keys. In PROD the relayer key must not be the job signer.

## Playbooks

**Compromised relayer (CRE DON, Gelato, leaked relay key).** Do nothing onchain unless jobs are also signed by a stolen signer. Relayers cannot change hops, minOut, targets, or amount. Rotate the relay credential offchain. Dual submit of the same `jobId` is `Replay`. Local-forge proof: `scripts/maintenance-failover.ts` → `ops/cre/simulation/failover-rehearsal.json`. Autonomous deployed-Gateway proof: `scripts/autonomous-relay-failover.ts` → `ops/cre/simulation/autonomous-relay-failover.json` (A-down/B-consumes failover liveness + simultaneous race with exactly one `JobConsumed`).

**Compromised job signer.** Guardian: `pauseGateway(true)` and/or `pauseKeeper(true)`, then `setJobSigner(new)`. Drain-in-flight jobs with a stolen signer can still waste a pot on a bad signed route until pause lands. They cannot redirect pots, change fees, or withdraw LP.

**Bad Top-10 snapshot.** Decision-service failure. Do not sign `submitEpoch`. `/top10` already fail-closes (`pauseEpoch`). Contracts still only check structure. CRE does not fix this.

**Split-brain daemons (#6).** Leadership is `leader_locks` renew + fence. Signing and broadcast sit inside `withSignAndBroadcastFence`. A lost fence refuses both. Do not raise TTL to “cover” a tick.

**Gateway or vault pause stuck.** Guardian unpauses when the signer and decision path are clean. `InstantCurve.graduate` stays permissionless through this.

**Arc Mainnet 5042.** Do not deploy. Do not enable CRE production writes. This repo hard-disables 5042.

See `KEEPER_MODEL.md`, `GUARDIAN_MODEL.md`, `/docs/automation`, `ops/cre/README.md`.
