# BUILD REPORT — Protocol 0.3.2 Postgres BIGINT timestamps

**Status:** Continue on existing REACTOR Origin repo. Parent `e398fd4` (protocol 0.3.1, Factory V1). Local Anvil 5042002 + Arc Public Testnet probe only.  
**Not audited. Not mainnet. Arc Public Testnet Factory create not claimed unless an explorer hash exists.**  
**Economics / 3.5% / curve / Top-10 / Keeper routing / Factory V1 constants: unchanged.**

## This HEAD

| Item | Value |
| --- | --- |
| Protocol release | **0.3.2** (`docs/version.json`) |
| Factory | **V1** (`FACTORY_VERSION = 1`, immutable) |
| Intent | P0: promote millisecond timestamp / lease columns to BIGINT so production Postgres can store `Date.now()` |
| Foundry | Unchanged this pass (parent 0.3.1 recorded 326 passed, 1 skipped) |
| Indexer / lib | `pnpm --filter indexer test` + `DATABASE_URL=… pnpm --filter indexer test:pg` + `pnpm docs:check`. CI: `postgres-ms-timestamps` |
| Mainnet | **Blocked** |

## Closed this run

| Leftover | Closed? | Evidence |
| --- | --- | --- |
| Postgres INTEGER overflow on `Date.now()` ms | **Yes** | Schema v6 `BIGINT` on `admission_hits.ts`, `issuance_bucket.updated_ms`, `leader_locks.ts` / `lease_until`, `keeper_operations.ts`, `alerts.ts`. Fresh DDL + v5 `ALTER COLUMN` |
| Existing v5 / current DB migrate without data loss | **Yes** | `pg-ms-timestamps.test.ts` seeds INTEGER rows, migrates, asserts values |
| Real Postgres `Date.now()` insert on admission / bucket / lock / job / alert | **Yes** | same test; v5 INTEGER rejects `Date.now()` on all six columns; GitHub Actions `postgres-ms-timestamps` |
| Keeper leadership + LaunchAuthorization issuance on Postgres | **Yes** | `withLeaderLock` / `tryAdvisoryLock` + `consumeIssuanceToken` + `admit` ALLOW |
| Seconds vs milliseconds documented | **Yes** | `ARCHITECTURE.md`, `LAUNCH_ADMISSION.md`, `docs/admission.md`, `docs/keeper.md`, `THREAT_MODEL.md` |

## Still blocked (do not fake)

| Blocker | Why |
| --- | --- |
| Public mainnet (5042) | Hard blocked. No addresses. |
| Independent Codex / professional audit | Not performed. Do not claim audited. |
| Top-10 as onchain oracle | Frozen offchain by design. |
| Arc Factory claimed | No funded `ARC_TESTNET_PK` in this environment. |

## EIP-170 sizes

Unchanged from 0.3.1. Factory **stays V1**. This pass is indexer schema only.

| Contract | Runtime (bytes) | Gate |
| --- | ---: | --- |
| ReactorFactory | **23,286** | ≤ 23,552 **pass** (unchanged) |

## Honest gaps that remain (not leftovers we pretended to close)

- Unix-seconds INTEGER columns still hit the year-2038 wall on Postgres. Not this P0.
- LOCAL Turnstile bypass when secret unset (explicit LOCAL only).
- Funding-parent is a heuristic (ASN + /16 + optional first-USDC-funder).
- Factory runtime must stay under the CI margin.

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.
