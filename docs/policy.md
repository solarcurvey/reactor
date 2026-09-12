# Docs policy

> Documentation is **mandatory in the same run** as any behavior change. Protocol **0.3.3**. Factory **V1**.

This in-app handbook (`/docs`) is the GitBook-style reading path. Root design files (`ECONOMICS.md`, `ARCHITECTURE.md`, …) remain auditor-facing sources. Do not invent protocol economics. Do not claim audited or trustless. Do not invent mainnet addresses.

## What must update together

Contracts, tokenomics, Factory, Guardian/Keeper, routing, admission, API, SDK, CORE, tickers, trust, UX — matching handbook page **and** the root file in `CONTRIBUTING.md`.

Protocol semver: `docs/version.json`. Factory `FACTORY_VERSION` is a different immutable number.

```bash
pnpm docs:gen    # regenerate versioning / deployments / changelog pages
pnpm docs:check  # fail on fee / supply / Dev Buy / ticker lock / factory / version / deployment drift
pnpm docs:links  # fail on broken in-repo /docs slugs and relative files (no network)
```

Do not edit generated `docs/versioning.md`, `docs/deployments.md`, or `docs/changelog.md` by hand.

CI: `pnpm test:lib` (fast) runs `docs:check` and `docs:links`. Full merge-candidate also runs job `docs-links`. Frequency and required gates: [CI and cost](/docs/ci) (Refs #69 / #17). Do not add a feature-branch `push` + `pull_request` pair.

## Handbook rules

- Audience pages (traders / creators / builders) are complete how-tos, not stubs.
- Protocol pages state frozen numbers exactly: **3.5%**, **2% holders**, **1%**, **0.5%**, **1B**, **5%** Dev Buy, **24h** ticker lock, CORE **100M/900M**.
- Top-10 is an offchain API. CHALLENGE ≠ ALLOW. Instant is bonding → ready → frozen → graduate.
- Search the sidebar by title, blurb, and keywords. Prev/next follows handbook order.
- `llms.txt` at `/llms.txt` and `docs/llms.txt` must list the current protocol release.

Repository visibility is **not** a docs:check knob. Do not publicize without founder instruction. Operator checklist: [Repo publicization](/docs/publicization) (Refs #72). Personal-mailbox trailers were remapped 2026-09-12 on advertised refs. Residual dangling SHAs are accepted; Support purge/GC is not a #72 AC. Agents must not flip visibility or force-push `main`.

See `CONTRIBUTING.md`, [Versioning](/docs/versioning), [How REACTOR works](/docs).
