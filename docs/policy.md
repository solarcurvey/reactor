# Docs policy

Documentation is **mandatory in the same run** as any behavior change: contracts, tokenomics, Factory, Guardian/Keeper, routing, admission, API, SDK, CORE, tickers, trust, UX, brand.

Brand / visual identity: founder-locked **Direction C — Industrial Forge**. Handbook: [Brand](/docs/brand). Issue #55 stays open until production surfaces and #36 baselines match. Do not change frozen V1 economics for paint.

Protocol semver: `docs/version.json`. Factory `FACTORY_VERSION` is a different immutable number.

```bash
pnpm docs:gen    # regenerate versioning / deployments / changelog pages
pnpm docs:check  # fail on fee / supply / Dev Buy / ticker lock / factory / version / deployment drift
pnpm docs:links  # fail on broken in-repo /docs slugs and relative files (no network)
```

Do not edit generated `docs/versioning.md`, `docs/deployments.md`, or `docs/changelog.md` by hand.

CI: `pnpm test:lib` (fast) runs `docs:check` and `docs:links`. Full merge-candidate also runs job `docs-links`. Frequency and required gates: [CI and cost](/docs/ci) (Refs #69 / #17). Do not add a feature-branch `push` + `pull_request` pair.

Repository visibility is **not** a docs:check knob. Do not publicize without founder instruction. Operator checklist: [Repo publicization](/docs/publicization) (Refs #72). Personal-mailbox trailers were remapped 2026-09-12 on advertised refs. Residual dangling SHAs are accepted; Support purge/GC is not a #72 AC. Agents must not flip visibility.

See `CONTRIBUTING.md`.
