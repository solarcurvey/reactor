#!/usr/bin/env bash
# Decide CI tier (issue #69). Path classification first, then FULL.
#
# Force-full (ignores path filters — the release fail-safe):
#   push to main, workflow_dispatch tier=full, or PR label `ci-full`.
# Ordinary non-draft PRs: FULL only when the diff is not docs-only/trivial.
# Docs-only / LICENSE / *.md PRs stay on the cheap gate even if ready_for_review.
# Empty/failed diffs fail-safe (docs_only=false) so a broken classifier cannot
# skip a required code merge-candidate.
#
# Usage (CI, env already set):
#   EVENT_NAME PR_DRAFT PR_LABELS DISPATCH_TIER BASE_SHA HEAD_SHA
#   bash scripts/ci-decide.sh
#
# Usage (tests):
#   scripts/ci-decide.sh --event pull_request --draft false --labels '' --files
#   scripts/ci-decide.sh --event pull_request --draft false --labels ci-full --fail-safe
#   scripts/ci-decide.sh --event workflow_dispatch --tier full --fail-safe
#   scripts/ci-decide.sh --event push --fail-safe
#
# Writes force_full=/full= plus ci-paths.sh flags to stdout and $GITHUB_OUTPUT.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATHS="$ROOT/scripts/ci-paths.sh"

EVENT_NAME="${EVENT_NAME:-}"
PR_DRAFT="${PR_DRAFT:-}"
PR_LABELS="${PR_LABELS:-}"
DISPATCH_TIER="${DISPATCH_TIER:-full}"
BASE_SHA="${BASE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-}"
PATH_MODE=""
PATH_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --event) EVENT_NAME="$2"; shift 2 ;;
    --draft) PR_DRAFT="$2"; shift 2 ;;
    --labels) PR_LABELS="$2"; shift 2 ;;
    --tier) DISPATCH_TIER="$2"; shift 2 ;;
    --base) BASE_SHA="$2"; shift 2 ;;
    --head) HEAD_SHA="$2"; shift 2 ;;
    --files|--fail-safe)
      PATH_MODE="$1"
      shift
      PATH_ARGS=("$@")
      break
      ;;
    --diff)
      PATH_MODE="$1"
      shift
      PATH_ARGS=("$@")
      break
      ;;
    *)
      echo "ci-decide: unknown arg $1" >&2
      exit 2
      ;;
  esac
done

has_ci_full() {
  echo ",${PR_LABELS}," | grep -q ',ci-full,'
}

FORCE_FULL=false
case "$EVENT_NAME" in
  push) FORCE_FULL=true ;;
  workflow_dispatch)
    if [ "${DISPATCH_TIER:-full}" != "fast" ]; then FORCE_FULL=true; fi
    ;;
  pull_request)
    if has_ci_full; then FORCE_FULL=true; fi
    ;;
esac

classify() {
  if [ -n "$PATH_MODE" ]; then
    bash "$PATHS" "$PATH_MODE" "${PATH_ARGS[@]+"${PATH_ARGS[@]}"}"
    return
  fi
  if [ "$EVENT_NAME" = "pull_request" ] && [ -n "${BASE_SHA}" ]; then
    bash "$PATHS" --diff "$BASE_SHA" "${HEAD_SHA:-}"
    return
  fi
  bash "$PATHS" --fail-safe
}

PATH_OUT="$(classify)"
printf '%s\n' "$PATH_OUT"

DOCS_ONLY=false
if printf '%s\n' "$PATH_OUT" | grep -qx 'docs_only=true'; then
  DOCS_ONLY=true
fi

FULL=false
if [ "$FORCE_FULL" = true ]; then
  FULL=true
elif [ "$EVENT_NAME" = "pull_request" ] && [ "${PR_DRAFT}" != "true" ] && [ "$DOCS_ONLY" != true ]; then
  FULL=true
fi

echo "force_full=${FORCE_FULL}"
echo "full=${FULL}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "force_full=${FORCE_FULL}"
    echo "full=${FULL}"
  } >> "$GITHUB_OUTPUT"
fi
