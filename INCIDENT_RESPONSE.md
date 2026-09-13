# Incident response — maintenance jobs

Not an audit. Not a runbook for stealing pots. Guardian is the brake pedal.

## Roles

| Role | Key / process | Rotate / halt |
| --- | --- | --- |
| Decision service | Indexer ValuationService, `GET /top10`, `/pricing/health` | Pause epoch (`pauseEpoch`) or take the API down. Do not guess marks |
| Auth signer | Production: dedicated AWS KMS secp256k1 key → `AutomationGateway.jobSigner` | Guardian `setJobSigner`. Disable the KMS key. Old jobs fail `BadSigner` after rotation |
| Relayer | Production: AWS KMS Relay A / Relay B; optional CRE / Gelato / any courier | Disable affected Lambda/KMS key. A compromised relayer cannot steer a signed job |
| Guardian | Immutable Safe | `pauseGateway`, `pauseKeeper`, `setJobSigner`, `setKeeper` (new gateway) |

Never reuse Guardian / maintenance signer / pricing / launch / deployer / relay keys. Production #83 has three distinct KMS keys: authorizer, Relay A, Relay B. The managed production runtime refuses raw maintenance/relay private-key environment fallbacks.

## Playbooks

**Compromised Relay A or Relay B.** Disable that Lambda and/or its KMS key. Keep the other relay alive. A relay can spend its own gas and submit/withhold an already-signed envelope; it cannot change hops, minOut, targets, weights, amount, snapshot, deadline, chain, or Gateway without invalidating the MaintenanceJob signature. Check `usedJob(jobId)` before replaying anything. Do not rotate the maintenance signer unless there is evidence it was also compromised.

**Both AWS relays unavailable.** Do not weaken Gateway authorization or restore a privileged Keeper EOA. Repair AWS/RPC, or enable a separately verified compatible courier using the same signed-job format. Pots may accumulate while execution is offline; frozen economics and vault balances remain onchain. Guardian pause is optional if only liveness is lost and no bad authorization exists.

**AWS account / IAM compromise.** Immediately use an independent AWS administrator session to disable the three #83 KMS keys and Lambda schedules/functions as appropriate. If the authorizer key may have been usable by the attacker, Guardian must `pauseGateway(true)` / `pauseKeeper(true)` and rotate `jobSigner` before resuming. Audit CloudTrail KMS `Sign`, IAM and Lambda changes. GitHub OIDC cannot control the authorizer Lambda because that role has an explicit `lambda:*` deny on the authorizer; unexpected authorizer, IAM, or KMS changes therefore indicate a broader AWS/admin compromise.

**Compromised maintenance authorizer KMS key or canonical decision service.** Guardian: `pauseGateway(true)` and/or `pauseKeeper(true)`, disable the authorizer KMS key, then provision a fresh isolated KMS key and `setJobSigner(new)`. Drain-in-flight jobs with a stolen signer can still waste a pot on a bad signed route until pause lands. They cannot redirect pots, change fees, or withdraw LP because Gateway/vault typed boundaries still apply.

**Bad Top-10 snapshot.** Decision-service failure. Do not authorize `submitEpoch`. `/top10` already fail-closes (`pauseEpoch`). Contracts still only check structure. CRE/AWS relays do not fix a bad ranking decision.

**Relay RPC timeout / ambiguous receipt.** First inspect the public tx hash if one exists and `AutomationGateway.usedJob(jobId)`. Never mint a replacement job or lower `minOut` just because one RPC is ambiguous. Relay B's delayed `usedJob` check is the normal failover path. Relay B sleeps only after a pending envelope exists; idle ticks return immediately. The next one-minute EventBridge tick is the retry boundary; Lambda async retries are disabled and each worker has reserved concurrency 1.

**Low relay gas balance.** CloudWatch `RelayGasBalanceWei` alarm fires per relay. Fund only the affected relay public address. The authorizer requires no gas because it never broadcasts. Never export a KMS private key to “top it up.”

**GitHub/OIDC concern.** Disable or delete the `${name_prefix}-github-deploy` role or remove the eventual deployment configuration. The role may update code for **Relay A/B only**. It is explicitly denied every Lambda action on the maintenance-authorizer, and it cannot directly call KMS, pass runtime roles, or alter Lambda configuration. Authorizer code/config and IAM/KMS/schedule changes require a human Terraform/admin path.

**Split-brain legacy decision daemons (#6).** Leadership is `leader_locks` renew + fence. Signing/broadcast in the #54 local/test transition sits inside `withSignAndBroadcastFence`. A lost fence refuses both. Do not raise TTL to “cover” a tick. Production #83 moves actual signing/broadcast into the KMS authorizer and independent relays.

**Gateway or vault pause stuck.** Guardian unpauses when the signer and decision path are clean. `InstantCurve.graduate` stays permissionless through this.

**Arc Public Testnet rehearsal failure.** Keep #83 open. Preserve tx/error/CloudWatch evidence, fix the exact failure, then rerun A-consumes/B-skips and A-down/B-consumes with fresh job ids. Do not use local Anvil evidence as a substitute for real KMS/Testnet proof.

**Arc Mainnet 5042.** Do not deploy from this pre-production branch. This repo still hard-disables 5042 until the final audited production cutover explicitly changes that release gate.

See `KEEPER_MODEL.md`, `GUARDIAN_MODEL.md`, `/docs/automation`, `/docs/keeper`, `infra/aws-relay/README.md`, `ops/cre/README.md`.
