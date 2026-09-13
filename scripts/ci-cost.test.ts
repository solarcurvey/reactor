#!/usr/bin/env npx tsx
/**
 * CI-cost invariants (issue #69). A skipped job is not a pass on the full
 * path. This file asserts workflow shape, docs-only PR classification, and
 * the force-full fail-safe. It does not stub Foundry / Playwright / Postgres.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const workflowsDir = join(root, ".github/workflows");
const ciYml = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
const ciDoc = readFileSync(join(root, "docs/ci.md"), "utf8");
const ciOkSh = readFileSync(join(root, "scripts/ci-ok.sh"), "utf8");

const HEAVY_JOBS = [
  "solidity",
  "web-production-security",
  "operator-policy-http",
  "web-qa",
  "live-toasts-ui",
  "obs-ui",
  "postgres-ms-timestamps",
  "docs-links",
  "web",
  "e2e-release-gate",
] as const;

type Flags = Record<string, string>;

function parseFlags(out: string, keys: readonly string[]): Flags {
  const got: Flags = {};
  for (const line of out.split("\n")) {
    const m = new RegExp(`^(${keys.join("|")})=(true|false)$`).exec(line.trim());
    if (m) got[m[1]!] = m[2]!;
  }
  return got;
}

function paths(args: string[], stdin?: string): Flags {
  const out = execFileSync("bash", [join(root, "scripts/ci-paths.sh"), ...args], {
    input: stdin,
    encoding: "utf8",
  });
  return parseFlags(out, ["solidity", "web", "indexer", "docs_only"]);
}

function decide(args: string[], stdin?: string): Flags {
  const out = execFileSync("bash", [join(root, "scripts/ci-decide.sh"), ...args], {
    input: stdin,
    encoding: "utf8",
  });
  return parseFlags(out, ["solidity", "web", "indexer", "docs_only", "full", "force_full"]);
}

function extractJob(id: string): { id: string; ifCond?: string } {
  const start = ciYml.search(new RegExp(`^  ${id}:\\s*$`, "m"));
  assert.ok(start >= 0, `missing job ${id}`);
  const rest = ciYml.slice(start);
  const next = rest.slice(1).search(/^  [a-z][\w-]*:\s*$/m);
  const body = next >= 0 ? rest.slice(0, next + 1) : rest;
  const ifMatch = /^\s+if:\s*(.+)$/m.exec(body);
  return { id, ifCond: ifMatch?.[1]?.trim() };
}

function evalJobIf(ifCond: string | undefined, d: Flags): boolean {
  if (!ifCond) return true;
  if (ifCond === "always()") return true;
  if (ifCond === "needs.decide.outputs.full == 'true'") return d.full === "true";
  if (ifCond === "needs.decide.outputs.full != 'true' && needs.decide.outputs.solidity == 'true'") {
    return d.full !== "true" && d.solidity === "true";
  }
  assert.fail(`unrecognized job if: ${ifCond}`);
}

function launchedJobs(d: Flags): string[] {
  const ids = [
    "constants-version-deployments",
    "page-budget",
    "foundry-targeted",
    ...HEAVY_JOBS,
    "ci-ok",
  ];
  return ids.filter((id) => evalJobIf(extractJob(id).ifCond, d));
}

function ciOk(env: Record<string, string>): { ok: boolean; stderr: string } {
  try {
    execFileSync("bash", [join(root, "scripts/ci-ok.sh")], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (err) {
    const e = err as { stderr?: string };
    return { ok: false, stderr: e.stderr ?? "" };
  }
}

const cheapOkEnv = {
  RESULT_DECIDE: "success",
  RESULT_CONSTANTS: "success",
  RESULT_PAGE_BUDGET: "success",
};

const fullOkEnv = {
  ...cheapOkEnv,
  RESULT_SOLIDITY: "success",
  RESULT_WEB_PRODUCTION_SECURITY: "success",
  RESULT_OPERATOR_POLICY_HTTP: "success",
  RESULT_WEB_QA: "success",
  RESULT_LIVE_TOASTS: "success",
  RESULT_OBS_UI: "success",
  RESULT_POSTGRES: "success",
  RESULT_DOCS_LINKS: "success",
  RESULT_WEB: "success",
  RESULT_E2E: "success",
};

// --- workflow inventory ----------------------------------------------------

const workflowFiles = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
assert.deepEqual(
  workflowFiles.sort(),
  ["ci.yml"],
  `unexpected workflows (duplicate push+PR files must not remain): ${workflowFiles.join(", ")}`,
);

for (const gone of ["docs-sync.yml", "live-toasts.yml", "keeper-lease-pg.yml", "web-qa.yml", "e2e-release.yml", "observability.yml"]) {
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

// Workflow must call the testable decide/ok scripts (not a second inline copy).
assert.match(ciYml, /run: bash scripts\/ci-decide\.sh/);
assert.match(ciYml, /run: bash scripts\/ci-ok\.sh/);
assert.match(ciYml, /outputs:[\s\S]*docs_only:/);

// Heavy jobs launch only when decide.full is true. Only foundry-targeted is path-gated.
assert.match(ciYml, /if: needs\.decide\.outputs\.full == 'true'/);
assert.match(
  ciYml,
  /if: needs\.decide\.outputs\.full != 'true' && needs\.decide\.outputs\.solidity == 'true'/,
);

for (const job of [
  "constants-version-deployments",
  "page-budget",
  "web-production-security",
  "operator-policy-http",
  "web-qa",
  "live-toasts-ui",
  "obs-ui",
  "postgres-ms-timestamps",
  "e2e-release-gate",
  "solidity + size-guard",
  "docs-links",
  "web",
  "ci-ok",
]) {
  const escaped = job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(ciYml, new RegExp(`name:\\s*${escaped}(?:\\s|$)`, "m"), `missing job ${job}`);
}

assert.match(ciYml, /pnpm test:lib/);
assert.match(
  readFileSync(join(root, "package.json"), "utf8"),
  /safe-genesis-builder\.test\.ts/,
  "#17 requires safe-genesis builder tests on the cheap test:lib path",
);
assert.match(ciYml, /pnpm test:web-security/);
assert.match(ciYml, /pnpm docs:links/);
assert.match(ciYml, /e2e\/smoke\.spec\.ts/);
assert.match(ciYml, /e2e\/interactive\.spec\.ts/);
assert.match(ciYml, /pnpm --filter web test:qa/);
assert.match(ciYml, /pnpm test:e2e:release/);
assert.match(ciYml, /pnpm --filter indexer test:pg-lease/);
assert.match(ciYml, /pnpm --filter indexer test:pg/);
assert.match(ciYml, /e2e\/live-toasts\.spec\.ts/);
assert.match(ciYml, /e2e\/obs-failure-injection\.spec\.ts/);
assert.match(ciYml, /playwright\.obs\.config\.ts/);
assert.match(ciYml, /FOUNDRY_PROFILE: ci/);

// obs-ui is full-tier only and must prove production next start (not draft/fast skip of the harness).
{
  const after = ciYml.split(/^  obs-ui:\s*$/m)[1] ?? "";
  const job = after.split(/^  [a-z][\w-]*:\s*$/m)[0] ?? "";
  assert.match(job, /if: needs\.decide\.outputs\.full == 'true'/);
  assert.match(job, /pnpm --filter web build/);
  assert.match(job, /playwright\.obs\.config\.ts/);
  assert.match(job, /e2e\/obs-failure-injection\.spec\.ts/);
  assert.match(job, /vendor-proof\.test\.ts/);
}
assert.match(ciYml, /test_hookBits/);
assert.match(ciYml, /pnpm size:guard/);

// ci-ok always reports (docs-only merge candidates need a required check)
// and the script rejects skipped full-gate jobs when FULL is not false.
assert.match(ciYml, /^    if: always\(\)$/m);
assert.match(ciOkSh, /skipped ≠ pass/);
assert.match(ciYml, /pnpm test:operator-policy-http/);
assert.match(ciYml, /pnpm test:page-budget/);
for (const name of [
  "solidity",
  "web-production-security",
  "operator-policy-http",
  "web-qa",
  "live-toasts-ui",
  "obs-ui",
  "postgres-ms-timestamps",
  "docs-links",
  "web",
  "e2e-release-gate",
]) {
  assert.match(ciOkSh, new RegExp(`require "${name}"`), `ci-ok.sh must require ${name} on the full path`);
}

// page-budget is required and always-on (no full-tier `if:` skip).
{
  const after = ciYml.split(/^  page-budget:\s*$/m)[1] ?? "";
  const job = after.split(/^  [a-z][\w-]*:\s*$/m)[0] ?? "";
  assert.match(job, /name:\s*page-budget/);
  assert.doesNotMatch(job, /^\s+if:/m, "page-budget must not skip (required on every PR)");
}

// #17 extras and #35 E2E are full-only jobs on this workflow (not a second push+PR file).
assert.match(ciYml, /name:\s*docs-links[\s\S]*if: needs\.decide\.outputs\.full == 'true'/);
assert.match(ciYml, /name:\s*web\n    needs: decide\n    if: needs\.decide\.outputs\.full == 'true'/);
assert.match(ciYml, /name:\s*e2e-release-gate[\s\S]*if: needs\.decide\.outputs\.full == 'true'/);

// Exact-head checkout
assert.match(ciYml, /github\.event\.pull_request\.head\.sha \|\| github\.sha/);

// Caches
assert.match(ciYml, /~\/\.cache\/ms-playwright/);
assert.match(readFileSync(join(root, ".github/actions/setup-foundry/action.yml"), "utf8"), /contracts\/cache/);
assert.match(
  readFileSync(join(root, ".github/actions/setup-foundry/action.yml"), "utf8"),
  /solc-static-linux/,
  "setup-foundry must prefetch solc 0.8.26 from official mirrors (not a missing svm CLI)",
);
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

assert.deepEqual(paths(["--files"], "packages/sanctions/src/screen.ts\n"), {
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

// --- docs-only PR vs force-full (issue #69 residual) -----------------------

const docsOnlyPr = decide(
  ["--event", "pull_request", "--draft", "false", "--labels", "", "--files"],
  "docs/ci.md\nREADME.md\nCHANGELOG.md\nLICENSE\n",
);
assert.equal(docsOnlyPr.docs_only, "true");
assert.equal(docsOnlyPr.full, "false", "ordinary docs-only non-draft PR must not set FULL");
assert.equal(docsOnlyPr.force_full, "false");

const docsLaunched = launchedJobs(docsOnlyPr);
for (const job of HEAVY_JOBS) {
  assert.equal(docsLaunched.includes(job), false, `docs-only PR must not launch ${job}`);
}
assert.equal(docsLaunched.includes("foundry-targeted"), false, "docs-only PR must not launch Foundry");
assert.ok(docsLaunched.includes("constants-version-deployments"));
assert.ok(docsLaunched.includes("page-budget"));
assert.ok(docsLaunched.includes("ci-ok"), "ci-ok still reports on the cheap path");

const trivialPr = decide(
  ["--event", "pull_request", "--draft", "false", "--labels", "", "--files"],
  ".gitignore\nLICENSE\n",
);
assert.equal(trivialPr.docs_only, "true");
assert.equal(trivialPr.full, "false");
for (const job of HEAVY_JOBS) {
  assert.equal(launchedJobs(trivialPr).includes(job), false, `trivial PR must not launch ${job}`);
}

const codeMergeCandidate = decide(
  ["--event", "pull_request", "--draft", "false", "--labels", "", "--files"],
  "contracts/src/ReactorHook.sol\n",
);
assert.equal(codeMergeCandidate.docs_only, "false");
assert.equal(codeMergeCandidate.full, "true");
assert.equal(codeMergeCandidate.force_full, "false");
for (const job of HEAVY_JOBS) {
  assert.ok(launchedJobs(codeMergeCandidate).includes(job), `code merge-candidate must launch ${job}`);
}

const docsWithCiFull = decide(
  ["--event", "pull_request", "--draft", "false", "--labels", "ci-full", "--files"],
  "docs/ci.md\n",
);
assert.equal(docsWithCiFull.docs_only, "true");
assert.equal(docsWithCiFull.force_full, "true");
assert.equal(docsWithCiFull.full, "true", "ci-full forces every required job even on docs-only");
for (const job of HEAVY_JOBS) {
  assert.ok(launchedJobs(docsWithCiFull).includes(job), `ci-full must launch ${job}`);
}

const dispatchFull = decide(["--event", "workflow_dispatch", "--tier", "full", "--fail-safe"]);
assert.equal(dispatchFull.force_full, "true");
assert.equal(dispatchFull.full, "true");
for (const job of HEAVY_JOBS) {
  assert.ok(launchedJobs(dispatchFull).includes(job), `workflow_dispatch full must launch ${job}`);
}

const dispatchDefault = decide(["--event", "workflow_dispatch", "--fail-safe"]);
assert.equal(dispatchDefault.full, "true", "documented dispatch default is full");

const mainPush = decide(["--event", "push", "--fail-safe"]);
assert.equal(mainPush.force_full, "true");
assert.equal(mainPush.full, "true");
for (const job of HEAVY_JOBS) {
  assert.ok(launchedJobs(mainPush).includes(job), `main push must launch ${job}`);
}

const draftCode = decide(
  ["--event", "pull_request", "--draft", "true", "--labels", "", "--files"],
  "contracts/src/ReactorHook.sol\n",
);
assert.equal(draftCode.full, "false");
assert.equal(launchedJobs(draftCode).includes("solidity"), false);
assert.equal(launchedJobs(draftCode).includes("foundry-targeted"), true);

// ci-ok rejects skipped required jobs on the full path; cheap path allows skips.
assert.equal(ciOk({ FULL: "true", ...fullOkEnv }).ok, true);
const skippedFull = ciOk({ FULL: "true", ...fullOkEnv, RESULT_SOLIDITY: "skipped" });
assert.equal(skippedFull.ok, false);
assert.match(skippedFull.stderr, /solidity was skipped/);
assert.equal(ciOk({ FULL: "true", ...fullOkEnv, RESULT_POSTGRES: "skipped" }).ok, false);
assert.equal(ciOk({ FULL: "true", ...fullOkEnv, RESULT_WEB: "skipped" }).ok, false);
assert.equal(ciOk({ FULL: "true", ...fullOkEnv, RESULT_E2E: "skipped" }).ok, false);
assert.equal(ciOk({ FULL: "true", ...fullOkEnv, RESULT_OBS_UI: "skipped" }).ok, false);
assert.equal(
  ciOk({
    FULL: "false",
    ...cheapOkEnv,
    RESULT_SOLIDITY: "skipped",
    RESULT_POSTGRES: "skipped",
    RESULT_WEB: "skipped",
    RESULT_E2E: "skipped",
    RESULT_WEB_PRODUCTION_SECURITY: "skipped",
    RESULT_OPERATOR_POLICY_HTTP: "skipped",
    RESULT_WEB_QA: "skipped",
    RESULT_LIVE_TOASTS: "skipped",
    RESULT_OBS_UI: "skipped",
    RESULT_DOCS_LINKS: "skipped",
  }).ok,
  true,
  "docs-only/cheap ci-ok must accept skipped heavy jobs",
);
assert.equal(
  ciOk({ FULL: "", ...fullOkEnv, RESULT_SOLIDITY: "skipped" }).ok,
  false,
  "unknown FULL must fail-safe to the full gate",
);

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
assert.match(ciDoc, /obs-ui/);
assert.match(ciDoc, /production `next start` Playwright/);
assert.match(ciDoc, /vendor-proof\.test\.ts/);
assert.match(ciDoc, /docs-only\/trivial/);
assert.match(ciDoc, /force_full/);
assert.match(ciDoc, /scripts\/ci-decide\.sh/);
assert.match(ciDoc, /scripts\/ci-ok\.sh/);

console.log("ci-cost invariants ok");
