# REACTOR AWS managed relay (#83)

This directory is the boring production execution path for the provider-agnostic `AutomationGateway` introduced by #51.

`canonical REACTOR planner / ValuationService -> durable Postgres queue -> KMS MaintenanceJob authorizer -> Relay A / Relay B -> AutomationGateway`

The canonical planner retains decision authority. The authorizer signs only an exact planner-produced job. Relay A/B only deliver an already-authorized typed job. A relay cannot substitute Top-10 members or weights, change routes/hops, lower `minOut`, change amount, change snapshot/window, or replay a consumed job.

## Security boundaries

Three AWS KMS asymmetric `ECC_SECG_P256K1` / `SIGN_VERIFY` keys are mandatory and distinct:

- `alias/reactor-<env>-authorizer`
- `alias/reactor-<env>-relay-a`
- `alias/reactor-<env>-relay-b`

The private keys never exist as environment variables, files, GitHub secrets, or process memory. `apps/indexer/src/kms-evm.ts` converts KMS DER ECDSA output to canonical low-s EVM signatures and recovers the expected address before use.

Production refuses `JOB_SIGNER_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, and `RELAYER_PRIVATE_KEY` in the managed path. Each Lambda IAM role can `kms:Sign` only with its own KMS key.

Guardian Safe, launch signer, pricing signer, deployer, maintenance signer, Relay A and Relay B must all be distinct. Supply those public privileged addresses in `REACTOR_FORBIDDEN_ADDRESSES` so identity derivation and relay startup fail closed on accidental reuse.

### API credentials are role-scoped

Do **not** share one maintenance API bearer token between the three AWS roles. Terraform creates one secret container per AWS role:

- `reactor/<env>/managed-relay/authorizer-api-token`
- `reactor/<env>/managed-relay/relay-a-api-token`
- `reactor/<env>/managed-relay/relay-b-api-token`

The authorizer IAM role can read only the authorizer token; Relay A only Relay A's token; Relay B only Relay B's token. The canonical queue service maps those tokens to capabilities:

| Role | Allowed |
| --- | --- |
| authorizer | `GET /ops/maintenance/unsigned`, `POST /ops/maintenance/signed` |
| Relay A | `GET /ops/maintenance/signed`, `POST /ops/maintenance/result` as A |
| Relay B | `GET /ops/maintenance/signed`, `POST /ops/maintenance/result` as B |

There is deliberately **no HTTP endpoint to enqueue an unsigned job**. The canonical planner calls `enqueueUnsignedMaintenance(...)` directly against the shared durable store. A compromised relay therefore cannot manufacture an unsigned decision job and ask the authorizer to bless it.

## Durable queue

`apps/indexer/src/maintenance-queue.ts` stores the exact canonical unsigned envelope, the one accepted signature, and append-only relay-result evidence. A duplicate `jobId` with different payload is rejected. A failed Relay A result leaves the signed job available to Relay B. A consumed/already-used/replay result completes it.

`apps/indexer/src/maintenance-queue-api.ts` is the role-scoped courier API. By default it binds to loopback; production should publish only the `/ops/maintenance/*` routes through the existing authenticated TLS ingress or equivalent private service path. Do not expose the backing database or add a client/public unsigned-job write path.

The remaining planner integration is intentionally narrow: switch the existing #54 Keeper's final sign/broadcast boundary to `enqueueUnsignedMaintenance(...)` using the exact envelope it already computes. Until that is done and tested, schedules stay disabled and #83 remains open.

## Why Relay B waits

Relay A attempts an eligible signed job immediately. Relay B waits 15 seconds by default, then checks `AutomationGateway.usedJob(jobId)` before transaction signing/broadcast. Normal operation therefore spends one relay signature/transaction. If A is unavailable, B proceeds. If A/B truly race, the Gateway's first-consume/replay boundary still permits one logical execution.

An unknown post-broadcast receipt is `ambiguous`, not an excuse for the same relay to blindly resubmit.

## Runtime

Three Node 22 Lambdas are scheduled by EventBridge (normally once per minute):

- authorizer
- relay-a
- relay-b

No VPC/NAT Gateway, Kubernetes, dedicated RDS, or always-on EC2 fleet is created. The workers use the canonical REACTOR maintenance queue API and Arc RPC over HTTPS.

CloudWatch Embedded Metric Format logs emit heartbeat, relay balance, consumed-job and failure metrics. Terraform creates Lambda error, missing-heartbeat and low-relay-balance alarms. Logs contain public addresses, job IDs and tx hashes only; never API tokens, private keys, signatures, signed envelopes, or secret RPC URLs.

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

Terraform creates the 3 KMS keys, isolated IAM roles, Lambdas, CloudWatch alarms, three role-scoped API-token secret containers, and one RPC secret container. It does **not** put secret values into Terraform state.

Populate these four secret values in AWS after the first apply:

- `reactor/staging/managed-relay/authorizer-api-token`
- `reactor/staging/managed-relay/relay-a-api-token`
- `reactor/staging/managed-relay/relay-b-api-token`
- `reactor/staging/managed-relay/rpc-url`

Put the same three API token values into the canonical queue service's secret configuration under `MAINTENANCE_AUTHORIZER_TOKEN`, `MAINTENANCE_RELAY_A_TOKEN`, and `MAINTENANCE_RELAY_B_TOKEN`. They must all be different. This is operational secret distribution, never repository content.

The workflow also calls `kms-identities.ts` after apply. Retain its public output as deployment evidence. Confirm all three EVM addresses are distinct and none equal Guardian, launch signer, pricing signer or deployer.

Set `REACTOR_JOB_SIGNER_ADDRESS` to the derived authorizer address before enabling the stack.

## Relay funding

Only Relay A and Relay B submit transactions and need Arc gas. The maintenance authorizer does not broadcast and should not need gas funds.

Fund the two derived relay addresses with a modest operational balance only after independently checking the addresses. Low-balance alarms use `low_relay_balance` (default 5 native units) and should be tuned after testnet gas measurements.

## Enable staging schedules

After all of these are true:

1. existing deterministic Keeper planner publishes its exact jobs into the durable maintenance queue instead of signing/broadcasting them itself;
2. role-scoped queue API is reachable over the reviewed TLS/private ingress;
3. Secrets Manager role tokens and RPC URL are populated;
4. `AutomationGateway` address is independently verified;
5. KMS authorizer address matches Gateway `jobSigner` configuration;
6. Relay A/B addresses are distinct and funded;
7. Arc Mainnet is **not** selected;

run `aws-managed-relay` again with `enable_schedules=true`.

## Required Arc Public Testnet evidence

#83 does not close on local mocks. Record at minimum:

1. real AWS KMS authorizer signs a real canonical planner job;
2. Relay A submits it through the deployed `AutomationGateway`;
3. Relay B cannot double-execute the same job;
4. deliberately make A unavailable and prove B independently consumes a fresh valid job;
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

- **Compromised relay / noisy relay:** disable its EventBridge rule or Lambda and rotate only that relay API token/KMS path if needed. It cannot enqueue or sign a maintenance job. The other relay continues.
- **Compromised relay API token:** revoke/rotate only that relay token. It cannot access unsigned jobs or post signatures.
- **Suspected maintenance signer compromise:** pause Gateway with Guardian, disable the authorizer schedule/key, rotate the authorizer token and KMS key through the reviewed Guardian procedure, then invalidate old-job assumptions before unpausing.
- **RPC outage:** leave ambiguous transactions non-retried by the same relay until chain state is independently reconciled; switch the RPC secret to the reviewed fallback.
- **AWS account outage:** protocol execution pauses unless another compatible provider is active. Relayers have liveness responsibility only; they cannot redirect protocol pots.
- **Queue/API failure:** fail closed. Never let a relay or authorizer synthesize its own economic decision.

#51 and #18 remain open until their independent post-merge/release gates are satisfied.
