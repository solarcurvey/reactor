#!/usr/bin/env bash
# Fail-safe path classifier for CI. A skipped heavy job is not a pass —
# this script only decides *optional* fast-tier Foundry. The full merge-candidate
# and main gates ignore these flags and always run required commands.
#
# Usage:
#   scripts/ci-paths.sh --diff BASE_SHA HEAD_SHA
#   scripts/ci-paths.sh --files          # file list on stdin
#   scripts/ci-paths.sh --fail-safe      # treat every area as changed
#
# Writes solidity=/web=/indexer=/docs_only= to stdout and $GITHUB_OUTPUT.
set -u

fail_safe() {
  echo "ci-paths: fail-safe — treat all areas as changed (${1:-unknown})" >&2
  emit true true true false
  exit 0
}

emit() {
  local solidity="$1" web="$2" indexer="$3" docs_only="$4"
  echo "solidity=${solidity}"
  echo "web=${web}"
  echo "indexer=${indexer}"
  echo "docs_only=${docs_only}"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "solidity=${solidity}"
      echo "web=${web}"
      echo "indexer=${indexer}"
      echo "docs_only=${docs_only}"
    } >> "${GITHUB_OUTPUT}"
  fi
}

is_docs() {
  local f="$1"
  case "$f" in
    docs/*|*.md|*.MD) return 0 ;;
    LICENSE|LICENSE.*|.gitignore|.gitattributes|.editorconfig) return 0 ;;
    *) return 1 ;;
  esac
}

is_solidity() {
  local f="$1"
  case "$f" in
    contracts/*|scripts/size-guard.ts) return 0 ;;
    *) return 1 ;;
  esac
}

is_web() {
  local f="$1"
  case "$f" in
    apps/web/*|packages/reactor/*|packages/sdk/*|scripts/scan-client-bundle.ts|playwright*.ts)
      return 0 ;;
    *) return 1 ;;
  esac
}

is_indexer() {
  local f="$1"
  case "$f" in
    apps/indexer/*|packages/reactor/*|packages/sdk/*|packages/sanctions/*|scripts/safe-genesis-builder.ts|scripts/safe-genesis-builder.test.ts)
      return 0 ;;
    *) return 1 ;;
  esac
}

classify() {
  local solidity=false web=false indexer=false
  local any=false docs_only=true
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    any=true
    if ! is_docs "$f"; then
      docs_only=false
    fi
    if is_solidity "$f"; then solidity=true; fi
    if is_web "$f"; then web=true; fi
    if is_indexer "$f"; then indexer=true; fi
  done
  if [ "$any" != true ]; then
    fail_safe "empty file list"
    return
  fi
  emit "$solidity" "$web" "$indexer" "$docs_only"
}

mode="${1:-}"
case "$mode" in
  --fail-safe)
    fail_safe "explicit"
    ;;
  --files)
    classify || fail_safe "classify"
    ;;
  --diff)
    base="${2:-}"
    head="${3:-}"
    if [ -z "$base" ] || [ -z "$head" ]; then
      fail_safe "missing BASE/HEAD"
    fi
    if ! list="$(git diff --name-only --no-renames "$base" "$head" 2>/dev/null)"; then
      fail_safe "git diff failed"
    fi
    printf '%s\n' "$list" | classify || fail_safe "classify"
    ;;
  *)
    fail_safe "usage"
    ;;
esac
