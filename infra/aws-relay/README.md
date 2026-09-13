# REACTOR AWS managed automation (#83)

This stack is the boring provider-agnostic production executor for `AutomationGateway`.
It does not change Factory V1, fee economics, ranking, routes, or vault safety floors.

## Roles

- `maintenance-authorizer`: polls the canonical REACTOR plan endpoint, verifies the exact job/args, signs only the EIP-712 `MaintenanceJob` digest with an AWS KMS `ECC_SECG_P256K1` key, and publishes the signed envelope.
- `relay-a`: immediately checks the next signed envelope, validates signature/payload/calldata, simulates the exact `AutomationGateway.onReport` call, and submits it with a distinct KMS transaction key.
- `relay-b`: same verifier, but for a real pending envelope waits 15 seconds by default and then checks `usedJob(jobId)`. Idle ticks return immediately. It sends only if A did not consume the job.

Private keys never exist in Terraform variables, Lambda environment variables, files, or process memory. KMS returns DER ECDSA signatures; runtime code normalizes low-s and recovers the configured/derived EVM signer before use.

The relay roles may `kms:GetPublicKey` for their own key and the maintenance public key. This exposes only public material; each relay has `kms:Sign` on its **own** transaction key only. Neither relay can sign a MaintenanceJob.

Each Lambda has reserved concurrency `1`. EventBridge invokes each worker once per minute with async retries disabled: a failed invocation is retried by the next scheduled tick, not by overlapping Lambda retries. Relay receipt waits are bounded below Lambda timeout; Relay B's default delay still leaves execution headroom.

## Trust / deployment boundary

The first Terraform apply is deliberately a human-admin operation because it creates the KMS keys, runtime IAM roles and GitHub OIDC trust. The maintenance-authorizer remains on that human-reviewed path because **code control of the authorizer is effectively control of its KMS signing authority**.

The GitHub OIDC role is **not** a Terraform administrator and cannot:

- call `kms:Sign` directly;
- alter or create KMS keys;
- alter runtime IAM policies;
- `iam:PassRole`;
- change Lambda environment/configuration;
- change EventBridge schedules or alarms;
- control, update, invoke, or otherwise operate the maintenance-authorizer Lambda (`lambda:*` is explicitly denied on that function).

It may only read/update code for the **Relay A and Relay B** functions. A compromised GitHub deployment path can therefore disrupt relay liveness or waste the relays' own gas, but it cannot deploy new code into the trusted maintenance authorizer. Its OIDC trust defaults to the exact `main` branch subject, not every ref in the repository.

REACTOR's #69 CI-cost gate intentionally allows only `.github/workflows/ci.yml`; do **not** add a second deployment workflow. `scripts/deploy-aws-relay-code.sh` updates Relay A/B only. When the real AWS stack exists, the existing `ci.yml` may expose an explicitly gated/manual relay-code deploy job that obtains OIDC credentials and calls that script. Authorizer code/config and all IAM/KMS changes continue through a separately reviewed human Terraform/admin action.

## One-time operator flow

1. Secure the AWS account/root user with MFA and billing alerts.
2. Build the Lambda artifact from repository root: `bash scripts/build-aws-relay-bundle.sh`.
3. Copy `terraform.tfvars.example` to an uncommitted `terraform.tfvars` and fill the Arc/testnet URLs/addresses.
4. As a human-approved AWS administrator, run `terraform init && terraform plan && terraform apply` in this directory. Review the plan: exactly three asymmetric KMS keys, three runtime roles/functions, schedules/alarms, the relay-code-only GitHub OIDC role, and an explicit authorizer-control deny on that OIDC role.
5. Record Terraform output `github_deploy_role_arn` plus region/name-prefix for the eventual single-workflow Relay A/B code deployment gate. Do **not** add AWS access-key secrets.
6. Derive/record the three public EVM addresses from KMS (`GetPublicKey` is public material). Fund Relay A/B only; the maintenance authorizer never sends a transaction.
7. Arc Public Testnet rehearsal: A consumes a real KMS-authorized job, B observes it used; disable A and prove B consumes a fresh job. Retain tx hashes + CloudWatch evidence.
8. Only after review/audit, approve Guardian Safe cutover so `Guardian.keeper == AutomationGateway` and the Gateway job signer is the maintenance-authorizer KMS address.
9. Ordinary reviewed **relay** runtime-code updates may use `pnpm build:aws-relay` followed by `bash scripts/deploy-aws-relay-code.sh` under short-lived OIDC/assumed-role credentials. Authorizer code, IAM/KMS/config, schedules, and alarms require the separately reviewed human Terraform/admin path.

No VPC/NAT Gateway, dedicated RDS, Kubernetes, or always-on EC2 is provisioned here.

## Endpoint contract

`plan_url` returns either HTTP 204/404 for idle or:

```json
{
  "job": {
    "gateway": "0x...",
    "chainId": "1883",
    "action": 1,
    "payloadHash": "0x...",
    "jobId": "0x...",
    "validAfter": "...",
    "deadline": "...",
    "snapshotHash": "0x..."
  },
  "args": "0x..."
}
```

The authorizer POSTs the signed envelope to `signed_job_sink_url`. `signed_job_source_url` returns that envelope (or `{ "jobs": [...] }`). Relays re-derive the signed payload and exact `onReport` calldata; they do not trust endpoint-provided calldata blindly.

The production endpoint implementation must authenticate authorizer/relay service traffic and persist signed envelopes idempotently by `jobId`; #83 stays open until that integration and real AWS/Testnet evidence exist.
