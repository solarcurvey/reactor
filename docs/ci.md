# CI and cost

Refs #69. Tokenomics, Factory V1, and architecture are **not** CI knobs. This page is the operator + cost inventory for GitHub Actions.

Public-fork harden from #74 (Refs #72) is **kept** on this single workflow: `permissions: contents: read`, every `actions/checkout` has `persist-credentials: false`, no `pull_request_target`, no workflow secrets. `pnpm test:lib` runs `test:ci-cost`, `scripts/ci-public-harden.test.ts`, `docs:check`, and `docs:links`. Operator checklist: [Repo publicization](/docs/publicization).

A **skipped job is not a pass**. Required release jobs must execute their acceptance commands. `continue-on-error` is forbidden. `ci-ok` fails if any full-gate job is `skipped`, `cancelled`, or `failure`.

## Three tiers

| Tier | When | What runs |
| --- | --- | --- |
| **Fast PR** | Every meaningful `pull_request` update (draft included) | `pnpm test:lib` (indexer + web unit + cheap security + `docs:check` + `docs:links` + this page’s invariants) plus visible `page-budget` (`pnpm test:page-budget`). Targeted Foundry + `size:guard` **only** when Solidity paths change. |
| **Full merge-candidate** | Non-draft PR (`ready_for_review` / later `synchronize`), label **`ci-full`**, or `workflow_dispatch` (default **full**) | Fast commands **plus** production Next / hostile-metadata (`pnpm test:web-security`), `live-toasts-ui`, full Foundry (`FOUNDRY_PROFILE=ci`, Attack suite, CREATE2 `test_hookBits`, `size:guard`), Postgres `test:pg` + two-worker `test:pg-lease` + `pg-smoke`, `docs:links` (explicit job), Playwright smoke + interactive (`web`). Path filters do **not** skip these. |
| **Main post-merge** | `push` to **`main`** only | The same full gate, once, on the merged SHA. |

Docs-only / Solidity-only / web-only drafts do not launch unrelated heavy matrices (no production `next build`, Playwright, Postgres, or CI-fuzz Foundry). On a **final merge candidate** those filters are ignored so #15 / #17 / #18 gates still run.

## Triggers (and the one exception)

| Event | Feature branch | `main` |
| --- | --- | --- |
| `pull_request` | Yes — this is the feature-branch gate | n/a |
| `push` | **No** | Yes — post-merge only |
| `workflow_dispatch` | Manual full (or fast) on an exact SHA | Manual re-run |

**Genuine exceptions** to “PR-event for feature branches, push-event for main”:

1. `push: branches: [main]` — required so merge commits get one integrated verification path.
2. `workflow_dispatch` — the **only** documented manual/reusable full-release dispatch. Default tier is **full**.

Do **not** add a bare `on: push` (every branch) next to `pull_request`. That is the duplicate-spend bug.

**No nightly / `schedule:` / cron matrices** while pre-traction. A scheduled heavy matrix needs an explicit cost note on this page.

## Concurrency

```
group: ci-ci-<pull_request.number | sha-<github.sha>>
cancel-in-progress: true   # except github.ref == refs/heads/main
```

A new force-push cancels the obsolete PR run. Main post-merge verification is keyed by SHA and **must not** be canceled by unrelated PRs or a later main commit.

## Path filters (fail-safe)

`scripts/ci-paths.sh` classifies the PR diff. If the list is empty or `git diff` fails, every area is treated as changed (Foundry may run on the fast tier). The full tier **ignores** the classifier.

| Area | Paths |
| --- | --- |
| Solidity | `contracts/**`, `scripts/size-guard.ts` |
| Web | `apps/web/**`, `packages/reactor/**`, `packages/sdk/**`, `scripts/scan-client-bundle.ts` |
| Indexer | `apps/indexer/**`, `packages/reactor/**`, `packages/sdk/**` |
| Docs-only | every file is `docs/**` or `*.md` (or license/gitignore) |

## Jobs and commands

| Job | Tier | Commands (must execute) |
| --- | --- | --- |
| `decide-tier` | always | Classify SHA + paths. Cheap. |
| `constants-version-deployments` | always | `pnpm test:lib` (includes `docs:check` + `docs:links`) |
| `page-budget` | always | `pnpm test:page-budget` (4k-market HTTP/RPC budgets; also in `test:lib`) |
| `foundry-targeted` | fast + Solidity paths | `forge test` (default profile) + `pnpm size:guard` |
| `solidity + size-guard` | full / main | `FOUNDRY_PROFILE=ci forge test` + Attack suite + CREATE2 `test_hookBits` + `pnpm size:guard` |
| `web-production-security` | full / main | `pnpm test:web-security` (production Next + live headers + bundle sentinel + XSS corpus) |
| `live-toasts-ui` | full / main | `pnpm test:live-toasts` identity + Playwright |
| `postgres-ms-timestamps` | full / main | `test:pg` + `test:pg-lease` (two-worker) + `pg-smoke` |
| `docs-links` | full / main | `pnpm docs:links` (in-repo slugs/files only; no network). Also in `test:lib` on the fast gate. |
| `web` | full / main | Playwright smoke + interactive (`e2e/smoke.spec.ts`, `e2e/interactive.spec.ts`). Capture shots stay `CAPTURE=1` local-only. Live-toasts Playwright stays on `live-toasts-ui`. |
| `ci-ok` | full / main | All of the above full jobs **and** `page-budget` `== success` |

`keeper-lease-pg` / `two-worker-postgres` is **folded** into `postgres-ms-timestamps` (`test:pg-lease` still runs). Do not add a second Postgres lease workflow.

## Sibling release gates (do not weaken)

Open product issues keep their acceptance commands. Attach new heavy jobs to **this** workflow with `if: needs.decide.outputs.full == 'true'`. Do not open another `push` + `pull_request` file.

| Issue / PR | Gate | Slot |
| --- | --- | --- |
| #17 (PR #42) | Full GitHub CI — Foundry, size guard, Attack, CREATE2, `docs:links`, Playwright smoke | `solidity + size-guard` plus full-only `docs-links` and `web`. Cheap `docs:links` also runs in `test:lib`. Not a second workflow. |
| #15 / #35 (PR #44) | Production browser + wallet E2E | Add a full-only job (`pnpm test:e2e:release` when that script exists). |
| #15 / #36 (PR #49) | Visual / a11y / failure-injection | Full-only job (`pnpm --filter web test:qa` when present). |
| #15 / #18 | Production-readiness parent | Same full-tier rule. Do not move those commands to optional / `continue-on-error`. |
| #37 (PR #50) | RPC page-budget | **Required** always-on job `page-budget` (`pnpm test:page-budget`) plus the same file in `test:lib`. Also required by `ci-ok`. Cheap SQLite unit — not a full-only heavy gate. |
| #39 (PR #46) | Observability | Full-only `obs-ui` job. |
| #38 | Live toasts | `live-toasts-ui` (full). Units also run in `test:lib` on the fast gate. |
| #41 / TESTING row 51 | Hostile metadata / CSP | Cheap units in `test:lib`; production build + Playwright corpus in `web-production-security`. |
| #35–#41 / #51 / #60 | Existing test requirements | Unchanged in substance. Reachable via `TESTING.md` commands and the full gate. |

Recommended required checks (branch protection): **`constants-version-deployments`** (always present), **`page-budget`** (always present — #37 4k-market HTTP/RPC budgets), and **`ci-ok`** (present on merge-candidate + main; requires `page-budget` success). Do not require a check that the fast tier skips.

## Manual full suite (billing-safe)

One dispatch, exact SHA:

1. Actions → **ci** → Run workflow.
2. Branch / tag = the merge-candidate SHA’s branch.
3. Tier = **full** (default).

```bash
gh workflow run ci.yml --ref <branch-or-tag> -f tier=full
```

No other recurring trigger exists.

## Before / after (typical agent rebase / force-push)

Draft feature-branch SHA, no `ci-full` label — the common Cursor agent loop.

| | Before (#69) | After |
| --- | --- | --- |
| Events | `push` (every branch) **and** `pull_request` | `pull_request` only |
| Workflow runs | 6 (`docs-sync` + `live-toasts-ui` + `keeper-lease-pg`) × 2 | **1** (`ci`) |
| Jobs | **10 jobs** (5 per event: docs-check/indexer, production Next + Playwright, Postgres, live-toasts Playwright, second Postgres lease) | **2–3 jobs** (`constants-version-deployments`, required `page-budget`, plus `foundry-targeted` only if Solidity changed) |
| Production `next build` | 2× | 0 |
| Playwright installs | 4× | 0 |
| Postgres two-worker | 4× (`postgres-ms-timestamps` + `keeper-lease-pg`, each event) | 0 |
| Cancel obsolete | none | force-push cancels in-progress |

Expected reduction for that cycle: **about 80–90% fewer jobs**, and **all** heavy minutes (Next / Playwright / Postgres / CI-fuzz Foundry) move to merge-candidate + main.

Ready-for-review / `ci-full` / `main`: **one** full path per SHA (not push+PR twice). Postgres lease is a single job, not two workflows.

## Caches / setup

- pnpm + Node 22: `.github/actions/setup-pnpm` (`cache: pnpm`).
- Foundry + `contracts/cache` + `~/.svm`: `.github/actions/setup-foundry`. After the cache restore, prefetch `solc 0.8.26` with `curl` retries from `binaries.soliditylang.org` and GitHub `ethereum/solidity` releases into `~/.svm/0.8.26/`. Foundry 1.8 has no `svm` CLI — do not skip `forge test` / Attack / CREATE2 / `size:guard` because that binary is missing.
- Playwright browsers: `~/.cache/ms-playwright` keyed on the lockfile.

Tiny isolated VMs that only repeated `pnpm install` were combined (`keeper-lease-pg` into `postgres-ms-timestamps`; docs + indexer + cheap security into `constants-version-deployments`).

## Local equivalent

```bash
pnpm test:lib          # fast gate (includes test:ci-cost + ci-public-harden + docs:check + docs:links + page-budget)
pnpm test:page-budget  # visible #37 fast job (same file as in test:lib)
pnpm docs:links        # in-repo /docs slugs + relative files (no network)
pnpm test:web-unit     # web lib unit (also inside test:lib)
# Solidity changed:
cd contracts && forge test -vv && cd .. && pnpm size:guard
# Full / merge-candidate:
FOUNDRY_PROFILE=ci bash -lc 'cd contracts && forge test -vv'
pnpm test:web-security
pnpm test:live-toasts
# pnpm --filter web exec playwright test e2e/smoke.spec.ts e2e/interactive.spec.ts
# docker compose up -d postgres
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg-lease
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke
```

See `TESTING.md`, `CONTRIBUTING.md`. Protocol release identity stays in `docs/version.json`.
