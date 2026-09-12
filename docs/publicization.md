# Repository publicization checklist

> **Do not publicize without founder instruction.** This page is an operator checklist for a possible future visibility change so GitHub-hosted Actions minutes work. It is **not** product mainnet readiness, **not** an audit, and **not** a visibility flip.

Refs **#72**. Coordinate with **#69** (CI cost / concurrency / staging). Do not weaken **#15 / #17 / #18** release gates.

Inventory snapshot: **2026-09-12**, `origin/main` `c159561`. Reachable refs were fetched the same day. Re-audit immediately before any visibility change — this page goes stale.

## Hard constraints (already followed for this pass)

| Constraint | Status |
| --- | --- |
| Repository visibility | **NOT changed.** Keep private until the founder explicitly flips Settings → visibility. |
| History rewrite / force-push | **NOT executed.** Personal-email remap is a **FOUNDER DECISION GATE** below. |
| Arc Mainnet (5042) | Not deployed. Still blocked. |
| Frozen V1 economics / architecture | Unchanged. |
| Issue #72 | **Stays open** until acceptance is verified. Do not `Fixes #72`. |

## Operator checklist (in order)

1. **Email rewrite decision (FOUNDER DECISION GATE).** Accept the current `Co-authored-by` personal-mailbox exposure, or authorize a `git filter-repo` noreply remap and a coordinated force-update of `main` plus every open PR head. See [Email exposure](#email-exposure). **Do not rewrite from an agent.**
2. **Branch prune.** Delete only refs listed as [safe to delete](#safe-to-delete). Leave every open-PR head and every branch that is not merge-empty vs `main`.
3. **Secret-scan clean.** Re-run gitleaks + trufflehog over `--all` reachable refs, including open PR heads. Classify fixtures vs live credentials. Rotate anything live **before** visibility changes. See [Secret scan](#secret-scan).
4. **Actions harden.** Confirm every workflow still has `permissions: contents: read`, every `actions/checkout` has `persist-credentials: false`, and there is no `pull_request_target` + untrusted checkout. Compatible with #69 staging / cancellation. See [Actions hardening](#actions-hardening).
5. **Re-audit immediately before visibility change.** Repeat steps 2–4 on the exact SHA you would publicize. Open drafts become world-readable. See [Open drafts](#open-drafts).
6. **Do not publicize without founder instruction.** A green CI run is not permission to flip visibility.

## Email exposure

Author / committer emails on reachable refs (204 commits, 2026-09-12):

| Email | Role | Commits (author / committer / trailer) |
| --- | --- | --- |
| `cursoragent@cursor.com` | Cursor Agent author + committer | 185 / 185 / 11 |
| `122492451+solarcurvey@users.noreply.github.com` | GitHub noreply author | 18 / 0 / 176 (`Co-authored-by`) |
| `noreply@github.com` | GitHub committer on squash merges | 0 / 18 / 0 |
| `noreply@cursor.com` | Initial commit | 1 / 1 / 0 |
| Personal Gmail mailbox | **`Co-authored-by` trailer only** — not Author/Committer | **55 commits on `main`** (55 / 55 all-refs) |

The personal mailbox is **not** written in this in-tree page (it would survive a later rewrite). The exact address is on the #72 pull request body for Davis.

No Author/Committer field uses a personal mailbox. The exposure is **commit-message `Co-authored-by` trailers** on 55 `main` commits. Publicizing without a rewrite publishes that mailbox to every clone.

### Proposed rewrite (DO NOT EXECUTE without founder OK)

History rewrite of personal emails is a **FOUNDER DECISION GATE**. Exact replace-text lines (personal mailbox → `122492451+solarcurvey@users.noreply.github.com`) are on the #72 pull request body so they are not baked into this page.

```bash
# Fresh clone. Install git-filter-repo. Do not run against a shared working tree.
git clone --mirror git@github.com:solarcurvey/reactor.git reactor-rewrite
cd reactor-rewrite

# 1) Remap Author/Committer if any personal mailbox appears later.
# 2) Rewrite Co-authored-by trailers (the current exposure) with --replace-text
#    using the mapping from the #72 PR body.

# Verify: no personal mailbox remains in author, committer, or message trailers.
git log --all --format='%ae %ce %B' | grep -Ei 'gmail|hotmail|icloud' && echo FAIL || echo clean

# Then coordinated force-update of main AND every open PR head, plus tags.
# Every open PR must be rebased onto the rewritten main. Communicate downtime.
```

Acceptance alternative: **keep the trailers**, document the mailbox as public, and skip the rewrite. That is also a founder decision.

This PR **does not** rewrite history, force-push `main`, or update open PR heads.

## Branch inventory

26 `origin` heads on 2026-09-12 (25 `cursor/*` + `main`). None of the `cursor/*` tips are ancestors of `main` (squash merges). Classification uses `git merge-tree --write-tree origin/main <branch>`: **merge-empty** means the tree equals `main` (safe). **Conflict** / remaining files means leave the ref.

### Open PR heads — do not delete

| Branch | PR | State |
| --- | --- | --- |
| `cursor/ci-cost-cut-7753` | #73 | Open (ready) — #69 CI cost |
| `cursor/fix-live-toasts-import-e635` | #58 | Open |
| `cursor/sanctions-ops-freshness-8fcc` | #70 | Draft |
| `cursor/sanctions-operator-policy-gate-3e7f` | #68 | Draft |
| `cursor/trusted-geo-policy-1252` | #67 | Draft |
| `cursor/ofac-sanctions-dataset-1a33` | #66 | Draft |
| `cursor/automation-gateway-51-77bf` | #54 | Draft |
| `cursor/arc-testnet-deploy-rehearsal-deab` | #52 | Draft — Refs #16 |
| `cursor/rpc-waterfalls-batching-0e20` | #50 | Draft |
| `cursor/ui-qa-visual-a11y-gate-de13` | #49 | Draft |
| `cursor/extensive-gitbook-docs-afa6` | #48 | Draft |
| `cursor/frontend-observability-e1e7` | #46 | Draft |
| `cursor/production-discovery-ux-38ee` | #45 | Draft |
| `cursor/e2e-release-gate-05a7` | #44 | Draft |
| `cursor/full-github-ci-418f` | #42 | Draft — #17 full CI |

### Safe to delete

Only one remote branch is merge-empty vs `main` **and** is not an open-PR head:

| Branch | Why |
| --- | --- |
| `cursor/keeper-lease-ci-flake-fb1f` | Merged #59. Closed no-op #71. `merge-tree` equals `main`. |

This pass **does not delete** that ref (conservative). Founder/operator may delete it from the GitHub UI after confirming no unrecovered notes live only on that tip.

### Leave (merged PR, not merge-empty — squash leftover or extra commits)

| Branch | Merged PR | Note |
| --- | --- | --- |
| `cursor/harden-untrusted-metadata-csp-6228` | #47 | merge-tree conflict |
| `cursor/live-buyback-burn-toasts-b686` | #43 | merge-tree conflict |
| `cursor/atomic-indexer-tick-7954` | #27 | merge-tree conflict |
| `cursor/burn-adjusted-supply-fdv-001a` | #23 | merge-tree conflict |
| `cursor/fix-build-report-rebase-markers-6f94` | #32 | merge-tree conflict |
| `cursor/media-key-url-alignment-de1c` | #20 | merge-tree conflict |
| `cursor/postgres-bigint-timestamps-2188` | #19 | merge-tree conflict |
| `cursor/pricing-signer-fail-closed-b308` | #26 | merge-tree conflict |

### Leave (closed / superseded, still has unique commits)

| Branch | Closed PR | Note |
| --- | --- | --- |
| `cursor/top10-current-supply-rank-03c4` | #34 | Superseded by merged #33. merge-tree conflict. |

When unsure, leave the ref.

## Secret scan

Full-history / all-ref scan on 2026-09-12 after `git fetch origin --prune` (200 commits / all `cursor/*` tips including open PR heads).

| Tool | Result |
| --- | --- |
| gitleaks 8.24.3 (`--log-opts=--all`) | 32 hits — **0 live credentials** |
| trufflehog 3.88.29 (`git file://`, verified+unverified) | 9 unverified, **0 verified** |

### Classification

| Class | What | Live? |
| --- | --- | --- |
| Ethereum `0x` + 40 hex | Deployed / local contract addresses in `hooks.ts` and `deployments/*.json`. gitleaks `generic-api-key` false positive. | No |
| Foundry Anvil `#0` | `0xac0974…ff80` in LOCAL scripts, `.env.example` comment, prod-gates deny-list. Public Foundry fixture. | No — refuse in PROD |
| Dummy JWT | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…signaturepart` on observability branches (`redact.test.ts`). | No |
| Dummy URL userinfo | `https://user:hunter2@…`, `https://user:pass@evil.example` in redaction / untrusted-metadata tests. | No |
| Placeholder DSN | `postgres://user:pass@host:5432` in `.env.example` / docs. | No |
| AWS example key | `AKIAIOSFODNN7EXAMPLE` on observability branches (AWS documentation example). | No |
| PEM / GitHub PAT / `sk_live` / Slack | Not found on any reachable ref. | — |

**No live credential was found. Nothing to rotate from this scan.** If a later scan finds a live secret: rotate immediately, do not commit it, do not leave it in a PR.

`.gitleaks.toml` allowlists the fixtures above so the next pre-publicize scan is quieter. Allowlist is not a substitute for re-running both tools.

## Actions hardening

In-repo, additive, compatible with #69:

- Workflow-level **and** job-level `permissions: { contents: read }` unless a future job proves it needs more (it does not today).
- Every `actions/checkout` sets `persist-credentials: false` (test-only workflows never push).
- No `pull_request_target`. Checkout uses the default `pull_request` / `push` SHA (or #69’s `pull_request.head.sha`).
- No `${{ secrets.* }}` and no `secrets: inherit` in workflow YAML — fork PR code cannot see repository secrets.
- `scripts/ci-public-harden.test.ts` (`pnpm test:lib`) fails if any of the above regresses.

#69 (open PR #73) already has workflow-level `permissions: contents: read` and omits `pull_request_target`. When that PR folds the three current workflow files into `.github/workflows/ci.yml`, **keep** `contents: read` and **add** `persist-credentials: false` on every checkout (including `decide-tier`). Do not re-introduce feature-branch `push` + `pull_request` pairs. Concurrency cancel on PRs / SHA-keyed main must stay.

GitHub Settings (operator, not this PR): before publicizing, set “Approval for running workflows from outside collaborators” to require approval for first-time / all outside forks. Do not enable “Send write tokens to workflows from pull requests.”

## Open drafts

Publicizing the repository makes these **open draft PRs** world-readable (titles, diffs, discussion):

#70 sanctions freshness, #68 sanctions operator policy, #67 trusted geo/IP, #66 OFAC dataset, #54 AutomationGateway, #52 Arc testnet rehearsal, #50 RPC waterfalls, #49 UI QA, #48 handbook docs, #46 observability, #45 discovery UX, #44 E2E release gate, #42 full GitHub CI.

Also open (not draft): #73 CI cost (#69), #58 live-toasts import.

Close, convert, or redact before visibility changes if any draft is not ready for a public audience.

## What this pass did not do

- Visibility was NOT changed.
- History was NOT rewritten.
- Did **not** force-update `main` / open PR heads.
- Did **not** delete remote branches.
- Did **not** close #72.
- Did **not** deploy Arc Mainnet or change frozen V1 economics.

See `CONTRIBUTING.md`, `TESTING.md`, `THREAT_MODEL.md`. Protocol identity stays in `docs/version.json`.
