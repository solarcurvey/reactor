#!/usr/bin/env bash
# ci-ok gate (issue #69). A skipped required job is not a pass on the full path.
#
# FULL=true  (ci-full / workflow_dispatch full / push to main / non-docs
#             merge-candidate): every listed result must be success.
# FULL=false (docs-only / draft / dispatch fast): only the always-on cheap
#             jobs must succeed. Skipped Solidity/Postgres/browser jobs are OK.
#
# Unknown FULL is treated as full (fail-safe: cannot skip the release gate).
set -euo pipefail

require() {
  local name="$1"
  local result="$2"
  echo "${name}=${result}"
  if [ "$result" != "success" ]; then
    echo "ci-ok: required job ${name} was ${result} (skipped ≠ pass)" >&2
    exit 1
  fi
}

require "decide" "${RESULT_DECIDE:?}"
require "constants-version-deployments" "${RESULT_CONSTANTS:?}"
require "page-budget" "${RESULT_PAGE_BUDGET:?}"

if [ "${FULL:-}" = "false" ]; then
  echo "ci-ok: cheap path — skipped full-gate jobs are allowed"
  exit 0
fi

require "solidity" "${RESULT_SOLIDITY:?}"
require "web-production-security" "${RESULT_WEB_PRODUCTION_SECURITY:?}"
require "operator-policy-http" "${RESULT_OPERATOR_POLICY_HTTP:?}"
require "web-qa" "${RESULT_WEB_QA:?}"
require "live-toasts-ui" "${RESULT_LIVE_TOASTS:?}"
require "obs-ui" "${RESULT_OBS_UI:?}"
require "postgres-ms-timestamps" "${RESULT_POSTGRES:?}"
require "docs-links" "${RESULT_DOCS_LINKS:?}"
require "web" "${RESULT_WEB:?}"
require "e2e-release-gate" "${RESULT_E2E:?}"
