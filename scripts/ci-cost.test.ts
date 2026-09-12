#!/usr/bin/env npx tsx
/**
 * CI-cost invariants (issue #69). A skipped job is not a pass; this file
 * only asserts workflow shape and path-filter fail-safe. It does not stub
 * Foundry / Playwright / Postgres.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const workflowsDir = join(root, ".github/workflows");
const ciYml = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
const ciDoc = readFileSync(join(root, "docs/ci.md"), "utf8");

function paths(args: string[], stdin?: string): Record<string, string> {
  const out = execFileSync("bash", [join(root, "scripts/ci-paths.sh"), ...args], {
    input: stdin,
    encoding: "utf8",
  });
  const got: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = /^(solidity|web|indexer|docs_only)=(true|false)$/.exec(line.trim());
    if (m) got[m[1]!] = m[2]!;
  }
  return got;
}

// --- workflow inventory ----------------------------------------------------

const workflowFiles = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
assert.deepEqual(
  workflowFiles.sort(),
  ["ci.yml"],
  `unexpected workflows (duplicate push+PR files must not remain): ${workflowFiles.join(", ")}`,
);

for (const gone of ["docs-sync.yml", "live-toasts.yml", "keeper-lease-pg.yml"]) {
  assert.equal(existsSync(join(workflowsDir, gone)), false, `${gone} must be removed (folded into ci.yml)`);
}

assert.match(ciYml, /^name:\s*ci\s*$/m);
assert.match(ciYml, /pull_request:/);
assert.match(ciYml, /push:\n\s+branches:\s*\[main\]/);
assert.match(ciYml, /workflow_dispatch:/);
assert.doesNotMatch(ciYml, /^\s+schedule:/m);
assert.doesNotMatch(ciYml, /continue-on-error:\s*true/);

// Feature-branch push is omitted. A `push:` that is not limited to main is the #69 bug.
assert.match(ciYml, /^  push:\n    branches: \[main\]$/m);
assert.doesNotMatch(ciYml, /^  push:\s*\n(?!    branches:)/m);

assert.match(ciYml, /concurrency:/);
assert.match(ciYml, /cancel-in-progress:\s*\$\{\{\s*github\.ref != 'refs\/heads\/main'\s*\}\}/);
assert.match(ciYml, /github\.event\.pull_request\.number \|\| format\('sha-\{0\}', github\.sha\)/);

assert.match(ciYml, /label `ci-full`/);
assert.match(ciYml, /ready_for_review/);
assert.match(ciYml, /ci-full/);

// Full-tier jobs must not path-skip. Only foundry-targeted is path-gated.
assert.match(ciYml, /if: needs\.decide\.outputs\.full == 'true'/);
assert.match(
  ciYml,
  /if: needs\.decide\.outputs\.full != 'true' && needs\.decide\.outputs\.solidity == 'true'/,
);

for (const job of [
  "constants-version-deployments",
  "page-budget",
  "web-production-security",
  "live-toasts-ui",
  "postgres-ms-timestamps",
  "solidity + size-guard",
  "docs-links",
  "web",
  "ci-ok",
]) {
  const escaped = job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(ciYml, new RegExp(`name:\\s*${escaped}(?:\\s|$)`, "m"), `missing job ${job}`);
}

assert.match(ciYml, /pnpm test:lib/);
assert.match(ciYml, /pnpm test:web-security/);
assert.match(ciYml, /pnpm docs:links/);
assert.match(ciYml, /e2e\/smoke\.spec\.ts/);
assert.match(ciYml, /e2e\/interactive\.spec\.ts/);
assert.match(ciYml, /pnpm --filter indexer test:pg-lease/);
assert.match(ciYml, /pnpm --filter indexer test:pg/);
assert.match(ciYml, /e2e\/live-toasts\.spec\.ts/);
assert.match(ciYml, /FOUNDRY_PROFILE: ci/);
assert.match(ciYml, /test_hookBits/);
assert.match(ciYml, /pnpm size:guard/);

// ci-ok must require success (skipped ≠ pass)
assert.match(ciYml, /test "\$\{\{ needs\.web-production-security\.result \}\}" = success/);
assert.match(ciYml, /test "\$\{\{ needs\.postgres-ms-timestamps\.result \}\}" = success/);
assert.match(ciYml, /test "\$\{\{ needs\.live-toasts-ui\.result \}\}" = success/);
assert.match(ciYml, /test "\$\{\{ needs\.solidity\.result \}\}" = success/);
assert.match(ciYml, /test "\$\{\{ needs\.page-budget\.result \}\}" = success/);
assert.match(ciYml, /pnpm test:page-budget/);
assert.match(ciYml, /test "\$\{\{ needs\.docs-links\.result \}\}" = success/);
assert.match(ciYml, /test "\$\{\{ needs\.web\.result \}\}" = success/);

// page-budget is required and always-on (no full-tier `if:` skip).
{
  const after = ciYml.split(/^  page-budget:\s*$/m)[1] ?? "";
  const job = after.split(/^  [a-z][\w-]*:\s*$/m)[0] ?? "";
  assert.match(job, /name:\s*page-budget/);
  assert.doesNotMatch(job, /^\s+if:/m, "page-budget must not skip (required on every PR)");
}

// #17 extras are full-only jobs on this workflow (not a second push+PR file).
assert.match(ciYml, /name:\s*docs-links[\s\S]*if: needs\.decide\.outputs\.full == 'true'/);
assert.match(ciYml, /name:\s*web\n    needs: decide\n    if: needs\.decide\.outputs\.full == 'true'/);

// Exact-head checkout
assert.match(ciYml, /github\.event\.pull_request\.head\.sha \|\| github\.sha/);

// Caches
assert.match(ciYml, /~\/\.cache\/ms-playwright/);
assert.match(readFileSync(join(root, ".github/actions/setup-foundry/action.yml"), "utf8"), /contracts\/cache/);
assert.match(readFileSync(join(root, ".github/actions/setup-pnpm/action.yml"), "utf8"), /cache: pnpm/);

// --- path classifier -------------------------------------------------------

assert.deepEqual(paths(["--files"], "docs/ci.md\nREADME.md\nCHANGELOG.md\n"), {
  solidity: "false",
  web: "false",
  indexer: "false",
  docs_only: "true",
});

assert.deepEqual(paths(["--files"], "contracts/src/ReactorHook.sol\n"), {
  solidity: "true",
  web: "false",
  indexer: "false",
  docs_only: "false",
});

assert.deepEqual(paths(["--files"], "apps/web/src/app/page.tsx\n"), {
  solidity: "false",
  web: "true",
  indexer: "false",
  docs_only: "false",
});

assert.deepEqual(paths(["--files"], "apps/indexer/src/keeper.ts\n"), {
  solidity: "false",
  web: "false",
  indexer: "true",
  docs_only: "false",
});

const mixed = paths(["--files"], "docs/ci.md\ncontracts/src/ReactorHook.sol\n");
assert.equal(mixed.solidity, "true");
assert.equal(mixed.docs_only, "false");

const empty = paths(["--files"], "\n");
assert.equal(empty.solidity, "true", "empty list must fail-safe to all-changed");
assert.equal(empty.docs_only, "false");

const unsafe = paths(["--fail-safe"]);
assert.equal(unsafe.solidity, "true");
assert.equal(unsafe.web, "true");
assert.equal(unsafe.docs_only, "false");

// --- operator doc ----------------------------------------------------------

assert.match(ciDoc, /Before \/ after/);
assert.match(ciDoc, /10 jobs/);
assert.match(ciDoc, /2–3 jobs/);
assert.match(ciDoc, /workflow_dispatch/);
assert.match(ciDoc, /ci-full/);
assert.match(ciDoc, /cancel-in-progress/);
assert.match(ciDoc, /skipped job is not a pass/i);
assert.match(ciDoc, /#15/);
assert.match(ciDoc, /#17/);
assert.match(ciDoc, /#18/);
assert.match(ciDoc, /No nightly/);
assert.match(ciDoc, /Refs #69/);
assert.match(ciDoc, /page-budget/);
assert.match(ciDoc, /Recommended required checks[\s\S]*page-budget/);

console.log("ci-cost invariants ok");
