# CI and cost

Refs #69. Tokenomics, Factory V1, and architecture are **not** CI knobs. This page is the operator + cost inventory for GitHub Actions.

Public-fork harden from #74 (Refs #72) is **kept** on this single workflow: `permissions: contents: read`, every `actions/checkout` has `persist-credentials: false`, no `pull_request_target`, no workflow secrets. `pnpm test:lib` runs `test:ci-cost`, `scripts/ci-public-harden.test.ts`, `scripts/safe-genesis-builder.test.ts`, `docs:check`, and `docs:links`. Operator checklist: [Repo publicization](/docs/publicization).

A **skipped job is not a pass**. Required release jobs must execute their acceptance commands. `continue-on-error` is forbidden. `ci-ok` fails if any full-gate job is `skipped`, `cancelled`, or `failure`.

## Three tiers

| Tier | When | What runs |
| --- | --- | --- |
| **Fast PR** | Every meaningful `pull_request` update (draft included) | `pnpm test:lib` (indexer + web unit + cheap security + Safe genesis builder + `docs:check` + `docs:links` + this page’s invariants + #61 sanctions fixtures + #63 geo-policy tests) plus visible `page-budget` (`pnpm test:page-budget`). Targeted Foundry + `size:guard` **only** when Solidity paths change. |
| **Full merge-candidate** | Non-draft PR (`ready_for_review` / later `synchronize`), label **`ci-full`**, or `workflow_dispatch` (default **full**) | Fast commands **plus** production Next / hostile-metadata (`pnpm test:web-security`), `web-qa` (visual / a11y / failure-injection), `live-toasts-ui`, full Foundry (`FOUNDRY_PROFILE=ci`, Attack suite, CREATE2 `test_hookBits`, `size:guard`), Postgres `test:pg` + two-worker `test:pg-lease` + `pg-smoke`, `docs:links` (explicit job), Playwright smoke + interactive (`web`), #35 `e2e-release-gate` (`pnpm test:e2e:release`). Path filters do **not** skip these. |
| **Main post-merge** | `push` to **`main`** only | The same full gate, once, on the merged SHA. |

Docs-only / Solidity-only / web-only drafts do not launch unrelated heavy matrices (no production `next build`, Playwright, Postgres, or CI-fuzz Foundry). On a **final merge candidate** those filters are ignored so #15 / #17 / #18 gates still run.

## Accepted #17 / #42 evidence

Product work for [#17](https://github.com/solarcurvey/reactor/issues/17) landed via [PR #42](https://github.com/solarcurvey/reactor/pull/42). Cite these runs — not older greens:

| Role | SHA | Run | Result |
| --- | --- | --- | --- |
| Merge-candidate | `11fdadb` | [`34727535121`](https://github.com/solarcurvey/reactor/actions/runs/34727535121) | exact-head `ci-ok` success |
| Post-merge `main` | `80d3cac` | [`34727638255`](https://github.com/solarcurvey/reactor/actions/runs/34727638255) | `ci-ok` success |

Later integrated closes: #37 after #50 `e5fd745` / [`34727279555`](https://github.com/solarcurvey/reactor/actions/runs/34727279555); #36 after #49 `ad7b457` / [`34729758795`](https://github.com/solarcurvey/reactor/actions/runs/34729758795); #61 after #66 `d08aa1c` / [`34731099571`](https://github.com/solarcurvey/reactor/actions/runs/34731099571); #63 after #67 `e712617` / [`34731788819`](https://github.com/solarcurvey/reactor/actions/runs/34731788819) (founder closed after post-merge verify); #62 after #68 `2002aed` / [`34733128955`](https://github.com/solarcurvey/reactor/actions/runs/34733128955). **#17 stays open** until #79 post-merge docs/CI. **#60 / #64 / #65 / #69 stay open.**

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
| Indexer | `apps/indexer/**`, `packages/reactor/**`, `packages/sdk/**`, `packages/sanctions/**` |
| Docs-only | every file is `docs/**` or `*.md` (or license/gitignore) |

## Jobs and commands

| Job | Tier | Commands (must execute) |
| --- | --- | --- |
| `decide-tier` | always | Classify SHA + paths. Cheap. |
| `constants-version-deployments` | always | `pnpm test:lib` (includes `docs:check` + `docs:links` + `safe-genesis-builder.test.ts` + #61 sanctions fixtures + #63 geo-policy tests) |
| `page-budget` | always | `pnpm test:page-budget` (4k-market HTTP/RPC budgets; also in `test:lib`) |
| `foundry-targeted` | fast + Solidity paths | `forge test` (default profile) + `pnpm size:guard` |
| `solidity + size-guard` | full / main | `FOUNDRY_PROFILE=ci forge test` + Attack suite + CREATE2 `test_hookBits` + `pnpm size:guard` |
| `web-production-security` | full / main | `pnpm test:restricted` (dev restricted UX + #62 write gate) then `pnpm test:web-security` (production Next + live headers + bundle sentinel + XSS corpus + `restricted-prod` four-state matrix) |
| `operator-policy-http` | full / main | `pnpm test:operator-policy-http` — real indexer + production Next HTTP matrix (#62). LOCAL `#64` freshness is pinned `#61` fixtures (no live OFAC unless `SANCTIONS_NETWORK=1`). Required by `ci-ok`. |
| `web-qa` | full / main | `pnpm --filter web test:qa` (production Next visual / a11y / failure-injection). Pixel baselines live on PR #49. |
| `live-toasts-ui` | full / main | `pnpm test:live-toasts` identity + Playwright |
| `postgres-ms-timestamps` | full / main | `test:pg` + `test:pg-lease` (two-worker) + `pg-smoke` |
| `docs-links` | full / main | `pnpm docs:links` (in-repo slugs/files only; no network). Also in `test:lib` on the fast gate. |
| `web` | full / main | Playwright smoke + interactive (`e2e/smoke.spec.ts`, `e2e/interactive.spec.ts`). Capture shots stay `CAPTURE=1` local-only. Live-toasts Playwright stays on `live-toasts-ui`. |
| `e2e-release-gate` | full / main | `pnpm test:e2e:release` (production Next + EIP-1193 / MV3 wallet; `xvfb-run`) |
| `ci-ok` | full / main | All of the above full jobs **and** `page-budget` `== success` (including `web-qa` and `e2e-release-gate`) |

`keeper-lease-pg` / `two-worker-postgres` is **folded** into `postgres-ms-timestamps` (`test:pg-lease` still runs). Do not add a second Postgres lease workflow.

## Sibling release gates (do not weaken)

Open product issues keep their acceptance commands. Attach new heavy jobs to **this** workflow with `if: needs.decide.outputs.full == 'true'`. Do not open another `push` + `pull_request` file.

| Issue / PR | Gate | Slot |
| --- | --- | --- |
| #17 (merged #42) | Full GitHub CI — Foundry, size guard, Attack, CREATE2, `docs:links`, Playwright smoke, Safe genesis | Landed. Accepted `11fdadb` / `34727535121` then `80d3cac` / `34727638255`. Gates remain on this workflow. **#17 stays open** until post-merge docs/CI after #79. |
| #15 / #35 (PR #44) | Production browser + wallet E2E | `e2e-release-gate` (full) — `pnpm test:e2e:release`. Do **not** add `e2e-release.yml`. |
| #15 / #36 (merged #49, closed) | Visual / a11y / failure-injection | `web-qa` (full). Closed after `ad7b457` / `34729758795`. Do not re-add `.github/workflows/web-qa.yml`. |
| #15 / #18 | Production-readiness parent | Same full-tier rule. Do not move those commands to optional / `continue-on-error`. |
| #37 (merged #50, closed) | RPC page-budget | Required always-on `page-budget`. Closed after `e5fd745` / `34727279555`. |
| #39 (PR #46) | Observability | Full-only `obs-ui` job. |
| #38 | Live toasts | `live-toasts-ui` (full). Units also run in `test:lib` on the fast gate. |
| #41 / TESTING row 51 | Hostile metadata / CSP | Cheap units in `test:lib`; production build + Playwright corpus in `web-production-security`. |
| #61 (merged #66, closed) | Exact official-list OFAC screening fixtures | Cheap units in `test:lib` (`@reactor/sanctions` + `sanctions-api.test.ts`). Closed after `d08aa1c` / `34731099571`. Live HTTPS is `SANCTIONS_NETWORK=1` / `test:sanctions:network` only — not a CI job. |
| #63 (merged #67 core; **reopened**) | Trusted geo / jurisdiction policy units + user-visible restricted state via #65 | `geo-policy.test.ts` in `test:lib`. Core accepted after `e712617` / `34731788819`. **#63 stays open** until PR #75 / #65 user-visible restricted state + post-merge verify. |
| #62 (merged #68, closed) | Operator policy gate | Cheap units in `test:lib` (`sanctions-policy`, `wallet-proof`, `operator-policy`, BFF, status GET). Full-only job `operator-policy-http` starts the real indexer + production Next and hits `/quote`, `/launch/authorize`, `/upload`, Next `/api/launch-pricing`. Official `#66`/`#67` bind via `tryBindOfficialPolicyPlugins`. Official #65 read: `GET /operator-policy/status`. Closed after `2002aed` / `34733128955`. No new workflow. |
| #65 (PR #75) | Restricted-access UX + #62 write-gate e2e | Full-only step on `web-production-security`: `pnpm test:restricted` (dev) then `pnpm test:web-security` (production `next build`/`next start` matrix in `restricted-prod.spec.ts`: wallet / geo / stale / allow on desktop + 390px, fail-closed, ignored LOCAL flags, write-gate bypass). Do not add a second workflow. **#65 stays open.** |
| #60 / #64 / #69 | Sanctions parent + freshness + CI cost | **Stay open.** |
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
pnpm test:lib          # fast gate (includes #61 sanctions fixtures + #63 geo-policy tests + test:ci-cost + ci-public-harden + safe-genesis + docs:check + docs:links + page-budget)
pnpm test:page-budget  # visible #37 fast job (same file as in test:lib)
pnpm docs:links        # in-repo /docs slugs + relative files (no network)
pnpm test:web-unit     # web lib unit (also inside test:lib)
# Solidity changed:
cd contracts && forge test -vv && cd .. && pnpm size:guard
# Full / merge-candidate:
FOUNDRY_PROFILE=ci bash -lc 'cd contracts && forge test -vv'
pnpm test:web-security
pnpm test:operator-policy-http  # #62 real indexer + production Next HTTP matrix (CI job operator-policy-http)
pnpm test:live-toasts
# pnpm --filter web exec playwright test e2e/smoke.spec.ts e2e/interactive.spec.ts
pnpm --filter web test:qa   # #36 visual / a11y / failure-injection (CI job web-qa)
pnpm test:e2e:release   # #35 full-only; Chromium/Firefox/WebKit + extension
# docker compose up -d postgres
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer test:pg-lease
# DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke
```

See `TESTING.md`, `CONTRIBUTING.md`. Protocol release identity stays in `docs/version.json`.
