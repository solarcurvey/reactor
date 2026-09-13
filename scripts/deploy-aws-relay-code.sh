#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIP_PATH="${AWS_RELAY_ZIP_PATH:-$ROOT/dist/reactor-aws-relay.zip}"
REGION="${AWS_REGION:-${AWS_RELAY_REGION:-}}"
PREFIX="${AWS_RELAY_NAME_PREFIX:-}"

command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 1; }
test -n "$REGION" || { echo "AWS_REGION or AWS_RELAY_REGION is required" >&2; exit 1; }
test -n "$PREFIX" || { echo "AWS_RELAY_NAME_PREFIX is required" >&2; exit 1; }
test -f "$ZIP_PATH" || { echo "bundle missing: $ZIP_PATH (run pnpm build:aws-relay)" >&2; exit 1; }

# GitHub/OIDC is intentionally allowed to update only the liveness relays.
# The maintenance-authorizer Lambda carries kms:Sign on the trusted decision key;
# its code/config changes require the human-reviewed Terraform/admin path.
for suffix in relay-a relay-b; do
  fn="${PREFIX}-${suffix}"
  echo "deploying reviewed relay code to $fn"
  aws --region "$REGION" lambda update-function-code \
    --function-name "$fn" \
    --zip-file "fileb://$ZIP_PATH" \
    --publish >/tmp/reactor-aws-deploy-${suffix}.json
  aws --region "$REGION" lambda wait function-updated --function-name "$fn"
done

echo "AWS Relay A/B code deployed; maintenance-authorizer/IAM/KMS/runtime configuration unchanged."
