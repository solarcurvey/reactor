#!/usr/bin/env npx tsx
/**
 * Public-fork GitHub Actions hardening (issue #72).
 *
 * Compatible with #69 three-tier CI: this file does not require a specific
 * workflow inventory. It asserts least-privilege on every workflow that
 * exists. When #69 folds docs-sync / live-toasts / keeper-lease-pg into
 * ci.yml, keep `permissions: contents: read` and
 * `persist-credentials: false` on every checkout.
 *
 * Does not weaken #15 / #17 / #18 release gates.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const workflowsDir = join(root, ".github/workflows");
const publicization = readFileSync(join(root, "docs/publicization.md"), "utf8");

const WRITE_PERMS = [
  "contents: write",
  "id-token: write",
  "pull-requests: write",
  "issues: write",
  "packages: write",
  "actions: write",
  "deployments: write",
  "security-events: write",
  "attestations: write",
];

function stripComments(src: string): string {
  return src
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

function workflowFiles(): string[] {
  return readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();
}

function checkoutBlocks(src: string): string[] {
  const lines = src.split("\n");
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/uses:\s*actions\/checkout@/.test(lines[i]!)) continue;
    const indent = lines[i]!.match(/^(\s*)/)?.[1]?.length ?? 0;
    const chunk = [lines[i]!];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === "") {
        chunk.push(line);
        continue;
      }
      const nextIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (nextIndent <= indent) break;
      chunk.push(line);
    }
    blocks.push(chunk.join("\n"));
  }
  return blocks;
}

const files = workflowFiles();
assert.ok(files.length > 0, "expected at least one workflow");

for (const name of files) {
  const raw = readFileSync(join(workflowsDir, name), "utf8");
  const src = stripComments(raw);

  assert.doesNotMatch(src, /pull_request_target/, `${name}: pull_request_target is forbidden`);
  assert.doesNotMatch(src, /secrets:\s*inherit/, `${name}: secrets: inherit is forbidden`);
  assert.doesNotMatch(src, /\$\{\{\s*secrets\./, `${name}: must not expose repository secrets to workflow steps (fork PRs included)`);

  assert.match(src, /^permissions:\s*\n(?:  [^\n]+\n)*  contents:\s*read\b/m, `${name}: workflow-level permissions.contents must be read`);

  for (const perm of WRITE_PERMS) {
    assert.doesNotMatch(src, new RegExp(perm.replace(":", "\\s*:\\s*")), `${name}: write permission ${perm} is not allowed on test workflows`);
  }

  const checkouts = checkoutBlocks(raw);
  assert.ok(checkouts.length > 0, `${name}: expected actions/checkout`);
  for (const [idx, block] of checkouts.entries()) {
    assert.match(
      block,
      /persist-credentials:\s*false/,
      `${name}: checkout #${idx + 1} must set persist-credentials: false`,
    );
  }
}

assert.match(publicization, /do not publicize without founder instruction/i);
assert.match(publicization, /FOUNDER DECISION GATE/i);
assert.match(publicization, /history rewrite \/ force-push/i);
assert.match(publicization, /\*\*Done\.\*\*/);
assert.match(publicization, /visibility was \*\*NOT\*\* changed/i);
assert.match(publicization, /filter-repo/);
assert.match(publicization, /persist-credentials:\s*`?false`?/);
assert.match(publicization, /#69/);
assert.match(publicization, /#15|#17|#18/);
assert.match(publicization, /accepted residuals \/ non-blocking/i);
assert.match(publicization, /\*\*AC1\.\*\*.*advertised/s);
assert.match(publicization, /not required/);
assert.doesNotMatch(publicization, /@gmail\.com/, "do not persist the personal mailbox in in-tree docs");
assert.doesNotMatch(publicization, /contact GitHub Support/i, "do not instruct operators to contact Support for #72");

console.log(`ci-public-harden ok (${files.length} workflow files)`);
