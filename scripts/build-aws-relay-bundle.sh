#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist/reactor-aws-relay.zip}"
BUILD="$ROOT/.aws-relay-build"
STAGE="$BUILD/stage"

command -v pnpm >/dev/null || { echo "pnpm is required" >&2; exit 1; }
command -v zip >/dev/null || { echo "zip is required (GitHub runners and WSL provide it)" >&2; exit 1; }
rm -rf "$BUILD"
mkdir -p "$STAGE" "$(dirname "$OUT")"

# Reuse the indexer's locked production dependency graph so the Lambda contains
# viem without adding a second JS dependency universe. Runtime AWS SDK v3 clients
# are provided by the managed Node.js Lambda runtime.
pnpm --filter indexer deploy --prod "$STAGE"
rm -rf "$STAGE/src" "$STAGE/data" || true
cp "$ROOT/ops/aws-relay/runtime/handler.mjs" "$STAGE/handler.mjs"
cp "$ROOT/ops/aws-relay/runtime/kms.mjs" "$STAGE/kms.mjs"
cp "$ROOT/ops/aws-relay/runtime/job.mjs" "$STAGE/job.mjs"

(
  cd "$STAGE"
  zip -qr "$OUT" .
)

echo "AWS relay Lambda bundle: $OUT"
