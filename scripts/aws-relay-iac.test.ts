import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const main = readFileSync(join(root, "infra/aws-relay/main.tf"), "utf8");
const vars = readFileSync(join(root, "infra/aws-relay/variables.tf"), "utf8");
const build = readFileSync(join(root, "scripts/build-aws-relay-bundle.sh"), "utf8");
const handler = readFileSync(join(root, "apps/indexer/src/aws-relay/handler.mjs"), "utf8");

assert((main.match(/ECC_SECG_P256K1/g) ?? []).length === 3, "exactly three secp256k1 KMS keys");
assert((main.match(/key_usage\s*=\s*"SIGN_VERIFY"/g) ?? []).length === 3, "all KMS keys are sign/verify only");
assert(main.includes('Resource = aws_kms_key.relay_a.arn'), "relay A signs only with relay A key");
assert(main.includes('Resource = aws_kms_key.relay_b.arn'), "relay B signs only with relay B key");
assert(main.includes('Resource = aws_kms_key.authorizer.arn'), "authorizer key is isolated");
assert(main.includes('Action   = "kms:GetPublicKey"'), "relays may read only authorizer public material");
assert(main.includes("token.actions.githubusercontent.com"), "GitHub OIDC is configured");
assert(main.includes("sts:AssumeRoleWithWebIdentity"), "OIDC uses web identity, not access keys");
assert(!/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(main + vars), "IaC must not require static AWS keys");
assert(!/aws_nat_gateway|aws_db_instance|aws_rds_|aws_eks_|kubernetes_/i.test(main), "no NAT/RDS/EKS relay tax");
assert(!/vpc_config\s*\{/.test(main), "Lambda stays out of a VPC unless separately justified");
assert(handler.includes("JOB_SIGNER_PRIVATE_KEY") && handler.includes("forbidden in the AWS managed production path"), "raw prod job key is fail-closed");
assert(handler.includes('relayDelayMs(role'), "relay B delay is enforced by runtime");
assert(handler.includes('functionName: "usedJob"'), "relay checks onchain replay state before spending gas");
assert(handler.includes("client.call"), "relay simulates exact Gateway call before KMS transaction signing");
assert(build.includes("pnpm --filter indexer deploy --prod"), "bundle uses locked indexer production deps");
assert(build.includes("apps/indexer/src/aws-relay/handler.mjs"), "bundle includes managed handler");

console.log("aws relay IaC static tests ok");
