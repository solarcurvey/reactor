# Contributing to REACTOR

This repository is **not audited**. Do not deploy to Arc Mainnet (5042). Do not claim the product is audited or trustless.

## Documentation is mandatory

Any change to the following **must** update the corresponding docs **in the same commit / same agent run**. Code-only or “docs later” is not acceptable.

| If you change… | You must update… |
| --- | --- |
| Contracts / ABI / events | `AUDIT_HANDOFF.md`, `/docs` events/api, `ARCHITECTURE.md` as needed |
| Tokenomics / fees / supply / Dev Buy / curve | `ECONOMICS.md`, `CURVE_DESIGN.md`, `/docs/fees`, `/docs/curve`, `/docs/index`, `docs:check` still green |
| Factory behavior or versioning | `FACTORY_VERSIONING.md`, `/docs/versioning`, `docs/version.json` factory fields **only if** Solidity `FACTORY_VERSION` changed (a new factory, not a protocol patch) |
| Guardian / Keeper powers | `GUARDIAN_MODEL.md`, `KEEPER_MODEL.md`, `PRIVILEGE_MAP.md`, `/docs/guardian` |
| Routing / adapters / minOut | `ARCHITECTURE.md`, `KEEPER_MODEL.md`, `/docs` builders/fees |
| Launch admission / signer / ticker rules | `LAUNCH_ADMISSION.md`, `TICKER_REGISTRY.md`, `/docs/tickers`, `/docs/creators` |
| Operator sanctions/geo policy / write-path enforcement | `/docs/operator-policy`, `/docs/trust`, `/docs/api`, `LAUNCH_ADMISSION.md` (`GET /operator-policy/status` for #65) |
| API behavior | `/docs/api`, `/docs/builders` |
| SDK interfaces | `/docs/sdk`, `packages/sdk` |
| CORE genesis / vest / book | `CORE_GENESIS.md`, `CORE_LIQUIDITY_DESIGN.md`, `/docs/core` |
| Backend trust assumptions | `THREAT_MODEL.md`, `/docs/index` (Trust), `AUDIT_HANDOFF.md` |
| Exact official-list screening / OFAC ingest | `SANCTIONS.md`, `/docs/sanctions`, `/docs/api`, `/docs/trust` |
| Geo / jurisdiction policy | `/docs/geo-policy`, `THREAT_MODEL.md`, `/docs/trust`, versioned `apps/indexer/config/geo-policy-us-comprehensive.v*.json` (source + effective date). No UI country lists. |
| User-facing behavior | matching `/docs` audience page + `UX_REFERENCE.md` if UX |
| Deployed addresses / chain / verification | `deployments/registry.json` + `pnpm docs:gen` (never invent mainnet addresses) |
| Protocol release identity | `docs/version.json`, `CHANGELOG.md`, git tag, `pnpm docs:gen` |

Also update `BUILD_REPORT.md` for the pass you are shipping, and `AUDIT_HANDOFF.md` when the auditor-facing surface moved.

Policy page (in-app): [`/docs/policy`](docs/policy.md).

## Versions

Two numbers, different jobs:

1. **Protocol release** — semver in `docs/version.json` (`protocolVersion`). Single source of truth. Root `package.json` `version` must match. Generated docs come from this file.
2. **Factory version** — `ReactorFactory.FACTORY_VERSION`. Immutable. **V1 stays V1 forever.**

A protocol `0.1.1` / `0.2.0` bump does not rewrite Factory V1. A different 3.5% split is Factory V2.

### Production release checklist

1. Bump `docs/version.json` (`protocolVersion`, `releaseTag` = `v` + version, `releaseDate`).
2. Add `## [X.Y.Z] - YYYY-MM-DD` to `CHANGELOG.md`.
3. `pnpm docs:gen` then `pnpm docs:check`.
4. Commit docs + version + changelog **with** the code.
5. Annotated tag: `git tag -a vX.Y.Z -m "REACTOR protocol X.Y.Z"` and push the tag.
6. Never move or reuse a tag. Factory versions are not tags.

`0.1.0` (`v0.1.0`) is the first baseline (this tree). There was no prior changelog.

## CI drift

`pnpm docs:check` (also run from `pnpm test:lib` and `.github/workflows/ci.yml` job `constants-version-deployments`) **must fail** when generated constants, deployment tables, or version labels have drifted from code/config. `pnpm docs:links` (same `test:lib` path, plus full-only job `docs-links`) **must fail** on unknown `/docs/<slug>` targets, missing relative files, or a `docs/*.md` page missing from `docs-nav.ts`. It does not fetch http(s) URLs.

`pnpm docs:check` fails when:

- Fee bps vs 3.5% / 2% holders / 1% / 0.5% copy
- Default supply (1B) and Dev Buy cap (5%)
- Ticker lock (24h) in Solidity and `ticker.ts`
- Factory version labels vs `FACTORY_VERSION`
- Protocol semver vs `package.json` / CHANGELOG / generated pages
- `deployments/local.json` vs web + indexer copies
- Stale `docs/versioning.md`, `docs/deployments.md`, `docs/changelog.md`
- A mainnet (5042) address appearing in generated tables

Do not “fix” a red check by editing generated markdown. Edit `docs/version.json` / `deployments/registry.json` / the Solidity source and regenerate.

Public-fork Actions hardening (Refs #72): every workflow has `permissions: contents: read`; every `actions/checkout` sets `persist-credentials: false`; no `pull_request_target`. The #69 fold keeps those rules on `.github/workflows/ci.yml`. `pnpm test:lib` runs `scripts/ci-public-harden.test.ts` and `scripts/ci-cost.test.ts`. Operator checklist: [`docs/publicization.md`](docs/publicization.md). **Do not publicize without founder instruction. Do not flip visibility from an agent. Do not run another history rewrite unless the founder authorizes it.** Residual pre-rewrite objects on GitHub `refs/pull/*` are an accepted residual; Support purge/GC is not a #72 AC.

## Engineering rules

See `AGENTS.md`. Security > cleverness. Do not change tokenomics to make a test pass. Do not deploy mainnet.

```bash
pnpm docs:check          # version + constants + deployments
pnpm docs:links          # in-repo docs slugs + relative files (no network)
pnpm test:lib            # indexer + web unit + #61 sanctions fixtures + docs:check + docs:links + safe-genesis + page-budget + CI-cost + public-fork harden
pnpm test:ci-cost        # workflow inventory / no duplicate push+PR / fail-safe paths
pnpm test:web-unit       # web lib unit (also in test:lib)
pnpm --filter web test:qa  # visual / a11y / failure-injection (CI ci.yml job web-qa, full/main)
cd contracts && forge test
```

GitHub Actions is three-tier (Refs #69): fast PR (`test:lib` + always-on `page-budget`), full merge-candidate (`ready_for_review`, label `ci-full`, or `workflow_dispatch`), main post-merge once. #17 leftover extras (`docs:links`, Playwright smoke + interactive) and #36 `web-qa` are full-only jobs on this same `ci.yml`. Do not add a feature-branch `push` + `pull_request` pair. Operator + before/after inventory: [`/docs/ci`](docs/ci.md).
