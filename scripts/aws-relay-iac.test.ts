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
const deployPolicy = main.slice(main.indexOf('resource "aws_iam_role_policy" "github_deploy"'));

assert((main.match(/ECC_SECG_P256K1/g) ?? []).length === 3, "exactly three secp256k1 KMS keys");
assert((main.match(/key_usage\s*=\s*"SIGN_VERIFY"/g) ?? []).length === 3, "all KMS keys are sign/verify only");
assert(main.includes('Resource = aws_kms_key.relay_a.arn'), "relay A signs only with relay A key");
assert(main.includes('Resource = aws_kms_key.relay_b.arn'), "relay B signs only with relay B key");
assert(main.includes('Resource = aws_kms_key.authorizer.arn'), "authorizer key is isolated");
assert(main.includes('Action   = "kms:GetPublicKey"'), "relays may read only authorizer public material");
assert(main.includes("token.actions.githubusercontent.com"), "GitHub OIDC is configured");
assert(main.includes("sts:AssumeRoleWithWebIdentity"), "OIDC uses web identity, not access keys");
assert(main.includes('"token.actions.githubusercontent.com:sub" = local.github_oidc_subject'), "OIDC trust uses one exact subject");
assert(main.includes('repo:${var.github_repository}:ref:refs/heads/main'), "OIDC default is main-only");
assert(!main.includes('repo:${var.github_repository}:*'), "OIDC must not trust every repo ref/environment");
assert(!/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(main + vars), "IaC must not require static AWS keys");
assert(!/aws_nat_gateway|aws_db_instance|aws_rds_|aws_eks_|kubernetes_/i.test(main), "no NAT/RDS/EKS relay tax");
assert(!/vpc_config\s*\{/.test(main), "Lambda stays out of a VPC unless separately justified");
assert((main.match(/reserved_concurrent_executions\s*=\s*1/g) ?? []).length === 3, "each worker is single-concurrency");
assert((main.match(/maximum_retry_attempts\s*=\s*0/g) ?? []).length === 3, "schedule retries disabled; next minute is the retry boundary");
assert((main.match(/REACTOR_RECEIPT_TIMEOUT_MS/g) ?? []).length === 2, "both relays bound receipt wait below Lambda timeout");
assert(main.includes('Action   = "lambda:UpdateFunctionCode"'), "GitHub OIDC role may deploy reviewed Lambda code");
assert(!/kms:Sign/.test(deployPolicy), "GitHub deploy role cannot sign with KMS");
assert(!/iam:PassRole/.test(deployPolicy), "GitHub deploy role cannot pass runtime roles");
assert(!/lambda:UpdateFunctionConfiguration/.test(deployPolicy), "GitHub deploy role cannot alter runtime configuration");
assert(handler.includes("JOB_SIGNER_PRIVATE_KEY") && handler.includes("forbidden in the AWS managed production path"), "raw prod job key is fail-closed");
assert(handler.includes('relayDelayMs(role'), "relay B delay is enforced by runtime");
assert(handler.includes('functionName: "usedJob"'), "relay checks onchain replay state before spending gas");
assert(handler.includes("client.call"), "relay simulates exact Gateway call before KMS transaction signing");
const idleReturn = handler.indexOf("if (!envelope) return");
const relaySleep = handler.indexOf("if (delay) await");
assert(idleReturn >= 0 && relaySleep > idleReturn, "relay B must not pay its grace delay on idle ticks");
assert(build.includes("pnpm --filter indexer deploy --prod"), "bundle uses locked indexer production deps");
assert(build.includes("apps/indexer/src/aws-relay/handler.mjs"), "bundle includes managed handler");

console.log("aws relay IaC static tests ok");
