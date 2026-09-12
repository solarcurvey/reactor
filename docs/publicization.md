# Repository publicization checklist

> **Do not publicize without founder instruction.** This page is an operator checklist for a possible future visibility change so GitHub-hosted Actions minutes work. It is **not** product mainnet readiness, **not** an audit, and **not** a visibility flip.

Refs **#72**. Coordinate with **#69** (CI cost / concurrency / staging). Do not weaken **#15 / #17 / #18** release gates.

Inventory snapshot: **2026-09-12** after the founder-authorized history rewrite, plus the same-day founder decision that Support purge/GC is **not required**. Re-audit immediately before any visibility change — this page goes stale.

## Hard constraints (this pass)

| Constraint | Status |
| --- | --- |
| Repository visibility | **NOT changed.** Keep private until the founder explicitly flips Settings → visibility. **FOUNDER DECISION GATE.** |
| History rewrite / force-push | **Done.** Personal-mailbox `Co-authored-by` trailers remapped with `git filter-repo --replace-text` + `--replace-message`. `origin/main` and every then-open PR head were force-updated. |
| Arc Mainnet (5042) | Not deployed. Still blocked. |
| Frozen V1 economics / architecture | Unchanged. |
| Issue #72 | **Stays open** until founder AC verify. Do not `Fixes #72`. |

## Operator checklist (in order)

1. **Email rewrite (AC1).** **Done** (founder-authorized). Personal mailbox must be absent from **advertised** refs: `main`, active open-PR heads, and intentional tags. Residual GitHub dangling objects are accepted — see [Accepted residuals / non-blocking](#accepted-residuals--non-blocking). Do not run another rewrite unless the founder authorizes a new remap.
2. **Branch prune.** **Done** for merged/superseded `cursor/*` leftovers. Keep only `main` + active open-PR heads + intentional tags. See [Branch inventory](#branch-inventory).
3. **Secret-scan clean.** Re-run gitleaks + trufflehog over `--all` reachable **advertised** refs (heads and tags) after every rewrite. Classify fixtures vs live credentials. Rotate anything live **before** visibility changes. See [Secret scan](#secret-scan).
4. **Actions harden.** Confirm every workflow still has `permissions: contents: read`, every `actions/checkout` has `persist-credentials: false`, and there is no `pull_request_target` + untrusted checkout. Compatible with #69 staging / cancellation. See [Actions hardening](#actions-hardening).
5. **Re-audit immediately before visibility change.** Repeat steps 2–4 on the exact SHA you would publicize. Open drafts become world-readable. See [Open drafts](#open-drafts).
6. **Do not publicize without founder instruction.** A green CI run is not permission to flip visibility.

## History rewrite (done 2026-09-12)

Founder (Davis Ramsey / solarcurvey) authorized a noreply remap and a coordinated force-update of `main` + open PR heads. Visibility was **not** flipped.

Mapping (personal mailbox is **not** written in this page):

```
<personal-gmail> ==> 122492451+solarcurvey@users.noreply.github.com
<personal-local-part> ==> solarcurvey
```

```bash
# What was run (fresh fetch of heads + tags only — not refs/pull/*):
git filter-repo \
  --replace-text replacements.txt \
  --replace-message replacements.txt \
  --replace-refs delete-no-add
# Then a follow-up --replace-message to restore the space in
# `Co-authored-by: solarcurvey <122492451+solarcurvey@users.noreply.github.com>`

# Verify on a clone that has only heads + tags:
git log --all --format='%ae %ce %B' | grep -Ei 'gmail|hotmail|icloud' && echo FAIL || echo clean
```

`--replace-text` alone rewrites **blobs**, not commit messages. The trailer exposure required `--replace-message`.

### SHA map

| Ref | Pre-rewrite | Post-rewrite |
| --- | --- | --- |
| `origin/main` | `c15956196418baca76280b9c6d98c11f3cbb24c9` | `a56065016731ac9af93b3aaec0bd896a94cc3397` (filter-repo tip), then `6b328373650722df480e744da26dbb6f4cfb7386` (squash-merge #74 hardening) |
| `refs/tags/v0.3.1` | `e398fd445cc877a8423719a3c711202268fe005e` | `d60d3158d7b2401bd71ff38fc10b9c598c07be35` |

`main` after this docs commit will move again (ordinary fast-forward). The filter-repo mapping above is the history rewrite itself.

### Verification (advertised refs: `main`, active PR heads, intentional tags)

```bash
git fetch origin --prune '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*'
# Default fetch is heads + tags only — not refs/pull/*.
git log --all --format='%ae %ce %B' | grep -Ei 'gmail|hotmail|icloud' && echo FAIL || echo clean
# Expect: clean
```

Author / committer / trailer emails on reachable heads+tags after rewrite:

| Email | Role |
| --- | --- |
| `cursoragent@cursor.com` | Cursor Agent author + committer (plus 11 `Co-authored-by` trailers) |
| `122492451+solarcurvey@users.noreply.github.com` | GitHub noreply author; remapped `Co-authored-by` trailers (55) |
| `solarcurvey@users.noreply.github.com` | Existing `Co-authored-by` trailers that already used the username form |
| `noreply@github.com` | GitHub committer on squash merges |
| `noreply@cursor.com` | Initial commit |

No personal mailbox remains in `%ae`, `%ce`, or `%B` on those advertised refs.

## Accepted residuals / non-blocking

Founder (Davis) decided Support purge/GC of pre-rewrite dangling SHAs is **not required**. Residual old-SHA exposure is **accepted**. These items are **not** remaining #72 acceptance criteria and are **not** a visibility-flip blocker.

- GitHub still stores pre-rewrite objects on closed/merged pull refs (`refs/pull/<n>/head`). `git clone` / default fetches do **not** get `refs/pull/*`. Those objects are not advertised as `main`, open-PR heads, or intentional tags.
- Agents cannot rewrite GitHub’s pull-ref namespace. Treat leftover `refs/pull/*` as residual cache, not an advertised branch.
- No operator ticket, Support request, or extra GC wait is part of #72.

## Branch inventory

After prune: **`main` + 17 open-PR `cursor/*` heads + tag `v0.3.1`.** No leftover merged/superseded `cursor/*` heads.

### Active open PR heads — keep

| Branch | PR | State |
| --- | --- | --- |
| `cursor/publicization-residual-docs-7459` | #77 | Open — founder residual / AC1 docs (this PR) |
| `cursor/ci-cost-cut-7753` | #73 | Open (ready) — #69 CI cost |
| `cursor/fix-live-toasts-import-e635` | #58 | Open |
| `cursor/restricted-access-ux-f91b` | #75 | Draft — Refs #65 |
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

#74 (`cursor/public-repo-ci-harden-5b18`) was squash-merged onto the rewritten `main` and the head ref was deleted.

### Deleted this pass (merged / superseded / unsanitized leftovers)

These remote heads were deleted so old objects are not advertised. Unique squash leftovers that were never on `main` are gone with the branch.

| Branch | Why |
| --- | --- |
| `cursor/keeper-lease-ci-flake-fb1f` | Merged #59. Closed no-op #71. merge-empty vs `main`. |
| `cursor/harden-untrusted-metadata-csp-6228` | Merged #47 leftover |
| `cursor/live-buyback-burn-toasts-b686` | Merged #43 leftover |
| `cursor/atomic-indexer-tick-7954` | Merged #27 leftover |
| `cursor/burn-adjusted-supply-fdv-001a` | Merged #23 leftover |
| `cursor/fix-build-report-rebase-markers-6f94` | Merged #32 leftover |
| `cursor/media-key-url-alignment-de1c` | Merged #20 leftover |
| `cursor/postgres-bigint-timestamps-2188` | Merged #19 leftover |
| `cursor/pricing-signer-fail-closed-b308` | Merged #26 leftover |
| `cursor/top10-current-supply-rank-03c4` | Closed #34, superseded by #33 |
| `cursor/public-repo-ci-harden-5b18` | Merged #74 onto rewritten `main` |

## Secret scan

Full-history / all-ref scan on **2026-09-12 after the rewrite + prune** (187 commits; current heads + `v0.3.1` only).

| Tool | Result |
| --- | --- |
| gitleaks 8.24.3 (`--log-opts=--all`) | 32 hits — **0 live credentials** |
| trufflehog 3.88.29 (`git file://`, verified+unverified) | 11 unverified, **0 verified** |

### Classification

| Class | What | Live? |
| --- | --- | --- |
| Ethereum `0x` + 40 hex | Deployed / local contract addresses in `hooks.ts` and `deployments/*.json`. gitleaks `generic-api-key` false positive. | No |
| Foundry Anvil `#0` | `0xac0974…ff80` in LOCAL scripts, `.env.example` comment, prod-gates deny-list. Public Foundry fixture. | No — refuse in PROD |
| Dummy JWT | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…signaturepart` on observability branches (`redact.test.ts`). | No |
| Dummy URL userinfo | `https://user:hunter2@…`, `https://user:pass@evil.example` in redaction / untrusted-metadata tests. | No |
| Placeholder DSN | `postgres://user:pass@host:5432` in `.env.example` / docs. | No |
| AWS example key | `AKIAIOSFODNN7EXAMPLE` on observability branches (AWS documentation example). | No |
| PEM / GitHub PAT / `sk_live` / Slack | Not found on any reachable head/tag. | — |

**No live credential was found. Nothing to rotate from this scan.** If a later scan finds a live secret: rotate immediately, do not commit it, do not leave it in a PR.

`.gitleaks.toml` allowlists the fixtures above so the next pre-publicize scan is quieter. Allowlist is not a substitute for re-running both tools.

## Actions hardening

On rewritten `main` (via merged #74; single `.github/workflows/ci.yml` after the #69 fold):

- Workflow-level `permissions: { contents: read }` unless a future job proves it needs more (it does not today).
- Every `actions/checkout` sets `persist-credentials: false` (test-only workflow never pushes).
- No `pull_request_target`. Checkout uses the default `pull_request` / `push` SHA (or #69’s `pull_request.head.sha`).
- No `${{ secrets.* }}` and no `secrets: inherit` in workflow YAML — fork PR code cannot see repository secrets.
- `scripts/ci-public-harden.test.ts` (`pnpm test:lib`) fails if any of the above regresses.

#69 (open PR #73) folded `docs-sync.yml` / `live-toasts.yml` / `keeper-lease-pg.yml` into `.github/workflows/ci.yml` and **kept** `contents: read` plus `persist-credentials: false` on every checkout (including `decide-tier`). Do not re-introduce feature-branch `push` + `pull_request` pairs. Concurrency cancel on PRs / SHA-keyed main must stay.

GitHub Settings (operator, not this PR): before publicizing, set “Approval for running workflows from outside collaborators” to require approval for first-time / all outside forks. Do not enable “Send write tokens to workflows from pull requests.”

## Open drafts

Publicizing the repository makes these **open draft PRs** world-readable (titles, diffs, discussion):

#75 restricted-access UX, #70 sanctions freshness, #68 sanctions operator policy, #67 trusted geo/IP, #66 OFAC dataset, #54 AutomationGateway, #52 Arc testnet rehearsal, #50 RPC waterfalls, #49 UI QA, #48 handbook docs, #46 observability, #45 discovery UX, #44 E2E release gate, #42 full GitHub CI.

Also open (not draft): #73 CI cost (#69), #58 live-toasts import.

Close, convert, or redact before visibility changes if any draft is not ready for a public audience.

## Remaining #72 ACs (founder)

- [x] **AC1.** Personal mailbox scrubbed from **advertised** refs (`main`, active open-PR heads, intentional tags). Residual GitHub dangling objects are **accepted** (see [Accepted residuals / non-blocking](#accepted-residuals--non-blocking)).
- [x] Merged/superseded Cursor branches pruned; active list intentional
- [x] Full-history/all-ref secret scan clean after fixture classification (advertised refs)
- [x] Any real credential rotated (none found)
- [x] Public-fork Actions least privilege + no dangerous `pull_request_target`
- [x] #69 cost controls still compatible
- [x] Final audit/scan notes on exact advertised refs after rewrite (this page)
- [ ] **Visibility flip** — still a **FOUNDER DECISION GATE**. Agents must not publicize.

Support purge/GC is listed under [Accepted residuals / non-blocking](#accepted-residuals--non-blocking), not here.

### Advertised-ref check (2026-09-12 founder follow-up)

Checked tip commit **author / committer / message** on `origin/main` `0bd9b82`, tag `v0.3.1` `d60d315`, and every then-open PR head (#77, #75, #73, #70, #68, #67, #66, #58, #54, #52, #50, #49, #48, #46, #45, #44, #42). Full history reachable from those advertised refs was also scanned.

| Check | Result |
| --- | --- |
| Personal gmail / hotmail / icloud on advertised-ref tips | **clean** |
| Same patterns in advertised-ref history (`%ae` `%ce` `%B`) | **clean** |
| Emails present | `cursoragent@cursor.com`, `122492451+solarcurvey@users.noreply.github.com`, `solarcurvey@users.noreply.github.com` (trailers), `noreply@github.com`, `noreply@cursor.com` |
| Secret scan (post-rewrite, advertised heads+tags) | gitleaks 8.24.3: 32 fixture hits, **0 live credentials**. trufflehog 3.88.29: 11 unverified, **0 verified**. GitHub secret-scanning API was not readable from this agent (403). This follow-up did not re-run gitleaks/trufflehog (binaries not in the environment). Classification is unchanged: nothing to rotate. |

## What this pass did not do

- Visibility was **NOT** changed.
- Did **not** close #72.
- Did **not** deploy Arc Mainnet or change frozen V1 economics.
- Did **not** invent a LICENSE.
- Did **not** rewrite GitHub `refs/pull/*` metadata. Residual dangling objects remain and are **accepted**.

See `CONTRIBUTING.md`, `TESTING.md`, `THREAT_MODEL.md`. Protocol identity stays in `docs/version.json`.
