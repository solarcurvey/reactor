# REACTOR AWS managed relay (#83)

This directory is the boring production execution path for the provider-agnostic `AutomationGateway` introduced by #51.

`canonical REACTOR decision service -> KMS MaintenanceJob authorizer -> signed immutable job -> Relay A / Relay B -> AutomationGateway`

The authorizer retains decision authority. Relay A/B only deliver an already-authorized typed job. A relay cannot substitute Top-10 members or weights, change routes/hops, lower `minOut`, change amount, change snapshot/window, or replay a consumed job.

## Security boundaries

Three AWS KMS asymmetric `ECC_SECG_P256K1` / `SIGN_VERIFY` keys are mandatory and distinct:

- `alias/reactor-<env>-authorizer`
- `alias/reactor-<env>-relay-a`
- `alias/reactor-<env>-relay-b`

The private keys never exist as environment variables, files, GitHub secrets, or process memory. `apps/indexer/src/kms-evm.ts` converts KMS DER ECDSA output to canonical low-s EVM signatures and recovers the expected address before use.

Production refuses `JOB_SIGNER_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, and `RELAYER_PRIVATE_KEY` in the managed path. Runtime roles may use only their own KMS key. The authorizer does not have a relay key; neither relay can sign a `MaintenanceJob`.

Guardian Safe, launch signer, pricing signer, deployer, maintenance signer, Relay A and Relay B must all be distinct. Supply those public privileged addresses in `REACTOR_FORBIDDEN_ADDRESSES` so identity derivation and relay startup fail closed on accidental reuse.

## Why Relay B waits

Relay A attempts an eligible signed job immediately. Relay B waits 15 seconds by default, then checks `AutomationGateway.usedJob(jobId)` before transaction signing/broadcast. Normal operation therefore spends one relay signature/transaction. If A is unavailable, B proceeds. If A/B truly race, the Gateway's first-consume/replay boundary still permits one logical execution.

An unknown post-broadcast receipt is `ambiguous`, not an excuse to blindly resubmit.

## Runtime

Three Node 22 Lambdas are scheduled by EventBridge (normally once per minute):

- authorizer
- relay-a
- relay-b

No VPC/NAT Gateway, Kubernetes, dedicated RDS, or always-on EC2 fleet is created. The workers use the canonical REACTOR maintenance job API and Arc RPC over HTTPS.

CloudWatch Embedded Metric Format logs emit heartbeat, relay balance, consumed-job and failure metrics. Terraform creates Lambda error, missing-heartbeat and low-relay-balance alarms. Logs contain public addresses, job IDs and tx hashes only; never API tokens, private keys, signatures, signed envelopes, or secret RPC URLs.

## Canonical maintenance API contract

The AWS worker deliberately does not decide protocol economics. It expects the canonical REACTOR service to expose an authenticated operator-only queue:

- `GET /ops/maintenance/unsigned` -> one exact unsigned envelope, or `204/404` if none.
- `POST /ops/maintenance/signed` -> persist the exact KMS-signed envelope.
- `GET /ops/maintenance/signed` -> one ready signed envelope for compatible relayers, or `204/404`.
- `POST /ops/maintenance/result` -> persist relay outcome (`consumed`, `already-used`, `replay`, `ambiguous`, `failed`).

Envelope JSON is serialized with `maintenanceEnvelopeToJson`; every relay re-parses and revalidates the action, chain, Gateway, payload hash, snapshot hash, validity window and maintenance signature before simulation/broadcast.

**Until those operator-only queue routes are connected to the existing deterministic Keeper planner / Postgres state, #83 remains incomplete and schedules must remain disabled.** Do not point these Lambdas at a public or client-controlled job source.

## One-time AWS bootstrap — founder/admin action

The stack itself is deployed from GitHub Actions using OIDC. It intentionally has no AWS access-key secrets.

From a secure administrator session, run the bootstrap Terraform once:

```bash
cd ops/aws/terraform/bootstrap
terraform init
terraform apply -var='aws_region=us-east-1'
```

Review the exact `github_subjects` first. They default to the protected GitHub Environments `reactor-staging` and `reactor-prod` for `solarcurvey/reactor`.

Bootstrap creates:

- GitHub OIDC provider;
- tightly scoped `reactor-managed-relay-github-deploy` role;
- encrypted/versioned S3 Terraform state bucket with public access blocked.

Record its outputs as GitHub Environment variables:

- `REACTOR_AWS_DEPLOY_ROLE_ARN`
- `REACTOR_TF_STATE_BUCKET`
- `REACTOR_AWS_REGION`

No AWS access key / secret key is added to GitHub.

## Protected GitHub Environment variables

Set separately in `reactor-staging` / `reactor-prod`:

- `REACTOR_AWS_DEPLOY_ROLE_ARN`
- `REACTOR_TF_STATE_BUCKET`
- `REACTOR_AWS_REGION`
- `REACTOR_CHAIN_ID`
- `REACTOR_GATEWAY_ADDRESS`
- `REACTOR_JOB_SIGNER_ADDRESS`
- `REACTOR_MAINTENANCE_API_BASE`
- `REACTOR_FORBIDDEN_ADDRESSES`

`REACTOR_JOB_SIGNER_ADDRESS` is intentionally blank on the first staging apply; schedules stay off while identities are derived.

## First stack apply — schedules OFF

Run GitHub Actions workflow `aws-managed-relay` with:

- environment: `staging`
- apply: `true`
- enable_schedules: `false`

Terraform creates the 3 KMS keys, isolated IAM roles, Lambdas, EventBridge definitions/alarms, and two Secrets Manager secret containers. It does **not** put secret values into Terraform state.

Populate these secret values in AWS after the first apply:

- `reactor/staging/managed-relay/api-token`
- `reactor/staging/managed-relay/rpc-url`

The workflow also calls `kms-identities.ts` after apply. Retain its public output as deployment evidence. Confirm all three EVM addresses are distinct and none equal Guardian, launch signer, pricing signer or deployer.

Set `REACTOR_JOB_SIGNER_ADDRESS` to the derived authorizer address before enabling the stack.

## Relay funding

Only Relay A and Relay B submit transactions and need Arc gas. The maintenance authorizer does not broadcast and should not need gas funds.

Fund the two derived relay addresses with a modest operational balance only after independently checking the addresses. Low-balance alarms use `low_relay_balance` (default 5 native units) and should be tuned after testnet gas measurements.

## Enable staging schedules

After all of these are true:

1. operator-only maintenance API queue is live;
2. Secrets Manager API token and RPC URL are populated;
3. `AutomationGateway` address is independently verified;
4. KMS authorizer address matches Gateway `jobSigner` configuration;
5. Relay A/B addresses are distinct and funded;
6. Arc Mainnet is **not** selected;

run `aws-managed-relay` again with `enable_schedules=true`.

## Required Arc Public Testnet evidence

#83 does not close on local mocks. Record at minimum:

1. real AWS KMS authorizer signs a real short-lived job;
2. Relay A submits it through the deployed `AutomationGateway`;
3. Relay B cannot double-execute the same job;
4. deliberately make A unavailable and prove B independently consumes a fresh job;
5. retain chain ID, Gateway, authorizer and relay public addresses, tx hashes and CloudWatch run evidence;
6. measure gas for every supported maintenance action that can be safely exercised.

Do not call CRE simulation, local Anvil, or a mocked KMS result this testnet evidence.

## Production cutover

Production apply is allowed only from `main` and should use the protected `reactor-prod` GitHub Environment.

Before turning production schedules on:

- #54 Gateway/job authorization is merged/audited;
- real testnet KMS/failover evidence above is accepted;
- production KMS public identities are retained and verified;
- production secrets are populated;
- relay gas balances are funded;
- alarms are enabled;
- incident rotation/disable procedure has been rehearsed;
- Guardian Safe sets `ReactorGuardian.keeper == AutomationGateway`;
- Gateway `jobSigner` equals the KMS-derived maintenance-authorizer address.

Factory V1 economics, fee split, curve rules and Top-10 ranking are not changed by this stack.

## Incident actions

- **Compromised relay / noisy relay:** disable its EventBridge rule or Lambda; its KMS key cannot authorize new maintenance jobs. The other relay continues.
- **Suspected maintenance signer compromise:** pause Gateway with Guardian, disable the authorizer schedule/key, rotate to a new KMS authorizer only through the reviewed Guardian procedure, then invalidate old-job assumptions before unpausing.
- **RPC outage:** leave ambiguous transactions non-retried until chain state is independently reconciled; switch the RPC secret to the reviewed fallback.
- **AWS account outage:** protocol execution pauses unless another compatible provider is active. Relayers have liveness responsibility only; they cannot redirect protocol pots.
- **API/job-store failure:** fail closed. Never let a relay synthesize its own maintenance job.

#51 and #18 remain open until their independent post-merge/release gates are satisfied.
