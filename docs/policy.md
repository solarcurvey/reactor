# Docs policy

Documentation is **mandatory in the same run** as any behavior change: contracts, tokenomics, Factory, Guardian/Keeper, routing, admission, API, SDK, CORE, tickers, trust, UX.

Protocol semver: `docs/version.json`. Factory `FACTORY_VERSION` is a different immutable number.

```bash
pnpm docs:gen    # regenerate versioning / deployments / changelog pages
pnpm docs:check  # fail on fee / supply / Dev Buy / ticker lock / factory / version / deployment drift
```

Do not edit generated `docs/versioning.md`, `docs/deployments.md`, or `docs/changelog.md` by hand.

Repository visibility is **not** a docs:check knob. Do not publicize without founder instruction. Operator checklist: [Repo publicization](/docs/publicization) (Refs #72). History rewrite of personal emails is a founder decision — agents must not force-push `main`.

See `CONTRIBUTING.md`.
