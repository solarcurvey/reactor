#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist/reactor-aws-relay.zip}"
BUILD="$ROOT/.aws-relay-build"
STAGE="$BUILD/stage"
MAX_ZIP_BYTES=$((50 * 1024 * 1024))
MAX_UNZIPPED_BYTES=$((250 * 1024 * 1024))

command -v pnpm >/dev/null || { echo "pnpm is required" >&2; exit 1; }
command -v zip >/dev/null || { echo "zip is required (GitHub runners and WSL provide it)" >&2; exit 1; }
rm -rf "$BUILD"
mkdir -p "$STAGE" "$(dirname "$OUT")"
rm -f "$OUT"

# Reuse the indexer's locked production dependency graph so the Lambda contains
# viem without adding a second JS dependency universe. Runtime AWS SDK v3 clients
# are provided by the managed Node.js Lambda runtime.
pnpm --filter indexer deploy --prod "$STAGE"
rm -rf "$STAGE/src" "$STAGE/data" || true
cp "$ROOT/apps/indexer/src/aws-relay/handler.mjs" "$STAGE/handler.mjs"
cp "$ROOT/apps/indexer/src/aws-relay/kms.mjs" "$STAGE/kms.mjs"
cp "$ROOT/apps/indexer/src/aws-relay/job.mjs" "$STAGE/job.mjs"

UNZIPPED_KIB=$(du -sk "$STAGE" | awk '{print $1}')
UNZIPPED_BYTES=$((UNZIPPED_KIB * 1024))
if (( UNZIPPED_BYTES > MAX_UNZIPPED_BYTES )); then
  echo "AWS relay bundle exceeds Lambda 250 MiB unzipped limit: ${UNZIPPED_BYTES} bytes" >&2
  exit 1
fi

(
  cd "$STAGE"
  zip -qr "$OUT" .
)

ZIP_BYTES=$(wc -c < "$OUT" | tr -d ' ')
if (( ZIP_BYTES > MAX_ZIP_BYTES )); then
  echo "AWS relay bundle exceeds direct Lambda 50 MiB zip limit: ${ZIP_BYTES} bytes" >&2
  exit 1
fi

echo "AWS relay Lambda bundle: $OUT (${ZIP_BYTES} bytes zipped; ${UNZIPPED_BYTES} bytes unzipped)"
