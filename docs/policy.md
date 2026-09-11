# Documentation policy

> Documentation is **mandatory** for every protocol change. Same commit / same run. Not a follow-up.

This page is the in-app copy of `CONTRIBUTING.md`. Auditors: see `AUDIT_HANDOFF.md`.

## What counts

If you touch contracts, tokenomics, Factory behavior, Guardian/Keeper powers, routing, launch admission, API behavior, SDK interfaces, CORE, ticker rules, backend trust assumptions, or user-facing behavior, you update the matching docs **now**.

| Surface | Canonical docs |
| --- | --- |
| Fees / supply / Dev Buy | `ECONOMICS.md`, [Fees](/docs/fees), [How it works](/docs) |
| Factory versions | `FACTORY_VERSIONING.md`, [Versioning](/docs/versioning) |
| Protocol release | `docs/version.json`, [Changelog](/docs/changelog) |
| Tickers / admission | `TICKER_REGISTRY.md`, `LAUNCH_ADMISSION.md`, [Tickers](/docs/tickers) |
| Guardian / Keeper | `GUARDIAN_MODEL.md`, `KEEPER_MODEL.md`, [Guardian](/docs/guardian) |
| API / SDK | [API](/docs/api), [SDK](/docs/sdk) |
| CORE | `CORE_GENESIS.md`, [CORE](/docs/core) |
| Deployments | `deployments/registry.json` → [Deployments](/docs/deployments) |
| Trust | `THREAT_MODEL.md`, Trust section on [How it works](/docs) |

## Versions (do not confuse them)

- **Protocol release** uses semantic versioning (`0.1.0`). Source: `docs/version.json`.
- **Factory V1** is an immutable on-chain constant. It stays V1 forever.

CI (`pnpm docs:check`) fails if fees, 1B supply, 5% Dev Buy, 24h ticker lock, Factory V1 labels, protocol semver, or deployment tables drift from code/config.

## Releases

Every production protocol release gets a `CHANGELOG.md` entry and a git tag `vMAJOR.MINOR.PATCH`. See [Versioning](/docs/versioning).

## Honesty

Do not write that REACTOR is audited or trustless. Do not invent Arc Mainnet (5042) addresses. Local Anvil rows are placeholders.
