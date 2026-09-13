# REACTOR AWS managed automation (#83)

This stack is the boring provider-agnostic production executor for `AutomationGateway`.
It does not change Factory V1, fee economics, ranking, routes, or vault safety floors.

## Roles

- `maintenance-authorizer`: polls the canonical REACTOR plan endpoint, verifies the exact job/args, signs only the EIP-712 `MaintenanceJob` digest with an AWS KMS `ECC_SECG_P256K1` key, and publishes the signed envelope.
- `relay-a`: immediately checks the next signed envelope, validates signature/payload/calldata, simulates the exact `AutomationGateway.onReport` call, and submits it with a distinct KMS transaction key.
- `relay-b`: same verifier, but delays 15 seconds by default and checks `usedJob(jobId)` first. It sends only if A did not consume the job.

Private keys never exist in Terraform variables, Lambda environment variables, files, or process memory. KMS returns DER ECDSA signatures; runtime code normalizes low-s and recovers the configured/derived EVM signer before use.

The relay roles may `kms:GetPublicKey` for their own key and the maintenance public key. This exposes only public material; each relay has `kms:Sign` on its **own** transaction key only. Neither relay can sign a MaintenanceJob.

## One-time operator flow

1. Secure the AWS account/root user with MFA and billing alerts.
2. Build the Lambda artifact from repository root: `bash scripts/build-aws-relay-bundle.sh`.
3. Copy `terraform.tfvars.example` to an uncommitted `terraform.tfvars` and fill the Arc/testnet URLs/addresses.
4. `terraform init && terraform plan && terraform apply` in this directory. The first human-admin apply bootstraps the GitHub OIDC deploy role; future reviewed deploys can assume that role without static AWS keys.
5. Derive/record the three public EVM addresses from KMS (`GetPublicKey` is public material). Fund relay A/B only; the maintenance authorizer never sends a transaction.
6. Arc Public Testnet rehearsal: A consumes a real KMS-authorized job, B observes it used; disable A and prove B consumes a fresh job. Retain tx hashes + CloudWatch evidence.
7. Only after review/audit, approve Guardian Safe cutover so `Guardian.keeper == AutomationGateway` and the Gateway job signer is the maintenance-authorizer KMS address.

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
