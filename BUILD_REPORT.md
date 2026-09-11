# BUILD REPORT — Protocol versioning, docs policy, CI drift

**Status:** Continue on existing REACTOR Origin repo. Parent `b43ebc3`. Local Anvil 5042002 only.  
**Not audited. Not mainnet. Arc Public Testnet not claimed.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Branch | `cursor/docs-versioning-ci-ead6` |
| Parent | `b43ebc3` |
| Protocol release | **0.1.0** (`docs/version.json`, tag `v0.1.0`) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | Davis docs/versioning/CI: mandatory docs, semver, changelog+tag, generated deployment tables, drift CI |
| Solidity / tokenomics | **None** |
| Mainnet | **Blocked** |

## What landed

1. **Docs are mandatory** for contracts, tokenomics, Factory, Guardian/Keeper, routing, admission, API, SDK, CORE, tickers, backend trust, and user-facing changes — `CONTRIBUTING.md`, `/docs/policy`, `AGENTS.md`, `AUDIT_HANDOFF.md`.
2. **Protocol semver** source of truth: `docs/version.json`. Root `package.json` version must match. Factory V1 is a different, frozen number.
3. **Generated** `/docs/versioning`, `/docs/deployments`, `/docs/changelog` via `pnpm docs:gen` from version + `deployments/registry.json` + `CHANGELOG.md` + `deployments/local.json`.
4. **CI** (`pnpm docs:check`, `pnpm test:lib`, `.github/workflows/docs-sync.yml`) fails on drifted fees, 1B supply, 5% Dev Buy, 24h ticker lock, Factory labels, protocol version, stale generated pages, drifted deployment.json copies, or a fabricated mainnet (5042) address.
5. **CHANGELOG.md** baseline for current HEAD as **0.1.0**. Tagging convention: annotated `vMAJOR.MINOR.PATCH`. Tag `v0.1.0` created for this release.
6. Deployment tables record Factory version (when applicable), protocol release, address, chain, source tag, date, verification. Local Anvil rows are **placeholders**. Testnet **not claimed**. Mainnet **no addresses**.

## How CI fails on drift

```bash
pnpm docs:check
# examples that must exit 1:
#  - change PROTOCOL_FEE_BPS copy in docs without the Solidity constant (or vice versa)
#  - bump package.json version without docs/version.json
#  - edit docs/deployments.md by hand
#  - let apps/web/src/lib/deployment.json diverge from deployments/local.json
#  - put a 0x address in the generated Arc Mainnet section
```

## Tests

| Suite | Result |
| --- | --- |
| `pnpm docs:check` | required green for this pass |
| Tokenomics / Foundry | not re-run for this docs-only change; last recorded 318 pass at `b43ebc3` |

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.
