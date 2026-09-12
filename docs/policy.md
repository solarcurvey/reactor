# Docs policy

Documentation is **mandatory in the same run** as any behavior change: contracts, tokenomics, Factory, Guardian/Keeper, routing, admission, API, SDK, CORE, tickers, trust, UX.

Protocol semver: `docs/version.json`. Factory `FACTORY_VERSION` is a different immutable number.

```bash
pnpm docs:gen    # regenerate versioning / deployments / changelog pages
pnpm docs:check  # fail on fee / supply / Dev Buy / ticker lock / factory / version / deployment drift
```

Do not edit generated `docs/versioning.md`, `docs/deployments.md`, or `docs/changelog.md` by hand.

GitHub Actions frequency and required gates: [CI and cost](/docs/ci) (Refs #69). Do not add a feature-branch `push` + `pull_request` pair.

Repository visibility is **not** a docs:check knob. Do not publicize without founder instruction. Operator checklist: [Repo publicization](/docs/publicization) (Refs #72). Personal-mailbox trailers were remapped 2026-09-12 on advertised refs. Residual dangling SHAs are accepted; Support purge/GC is not a #72 AC. Agents must not flip visibility.

See `CONTRIBUTING.md`.
