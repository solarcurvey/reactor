# BUILD REPORT — Permanent launch identity + docs + production UI

**Status:** Continue on existing REACTOR Origin repo. Local Anvil 5042002 only.  
**Not audited. Not mainnet. Arc Public Testnet not claimed.**  
**Parent:** `71c87eb` (production stack pass). Economics / 3.5% / curve / Top-10 / Keeper routing **unchanged**.

## This HEAD

| Item | Value |
| --- | --- |
| Branch | `cursor/launch-identity-docs-9632` |
| Parent | `71c87eb` |
| Intent | Global TickerRegistry + EIP-712 LaunchAuthorization + factory versioning + LaunchAdmission + first-class `/docs` + indexer/UI production fixes |
| Solidity | Narrow: ticker / auth / factory versioning + CoreToken rename. No fee / curve / split / Top-10 change. |
| Mainnet | **Blocked** pending Codex + audits + KMS/Safe rehearsal |

## Major A — Permanent launch identity

1. Global `TickerRegistry` (not inside a factory). Canonical ticker: uppercase A–Z0–9, max 10. Shared `Ticker.sol` / `packages/reactor/src/ticker.ts`.
2. Successful launch → 24h global lock via `claimOnLaunch`. Failed/expired auth does not squat.
3. Guardian `permanentlyLockTicker` one-way. Not an mcap oracle. Reserved: CORE, REACTOR, USDC, ZEC, WBTC, EURC.
4. Immutable factory versions. Authorize/deprecate for **new** launches only. Version persisted on every token.
5. Every launch (including USDC) requires EIP-712 `LaunchAuthorization`. Unique `authId`, digest replay, no serial quote nonce. Launch Signer ≠ Keeper ≠ Guardian Safe.
6. `LaunchAdmissionService` ALLOW/CHALLENGE/DENY + Turnstile + NORMAL/ELEVATED/ATTACK. No KYC. Refundable bond **FUTURE only**. `GET /ticker/:ticker`. `@reactor/sdk`.

Contract tests §94–97 + auth §95.

## Major B — Production backend/UI

Indexer: both OfficialPoolCreated forms; durable pool maps; `chainId+txHash+logIndex`; transactional migrations v1–v3; SQL `/markets` pagination; `price_quote_x18` for curve and v4; ValuationService nested multiply; RouteGraph proven edges; Postgres advisory lock via pinned client + lease table; SSE; R2/S3 path with local disk fallback; Safe genesis Batch A → Verify → Batch B; TestCORE → CoreToken (REACTOR CORE / CORE) tokenomics unchanged.

UI: Ops off public nav; Docs in primary nav; launch ticker live status; Lightweight Charts; fixtures for Playwright/390.

## Major C — Docs

`/docs` shell: sidebar, search, TOC, callouts, copy. Source `docs/`. Audience paths Trader / Creator / Builder. Honest: never audited / never trustless. `llms.txt`. CI `constants-sync.test.ts`.

## Tests

| Suite | Result |
| --- | --- |
| `forge test` | **318 passed / 0 failed** (1 skipped) |
| `pnpm --filter indexer test` | ok (keeper, persist, schema, quote-api, routes, valuation, prices, ticker) |
| `tsx apps/web/src/lib/constants-sync.test.ts` | ok |
| Playwright | **10 passed / 0 failed** (smoke + interactive, including `/docs`) |

## Honest gaps

- No live Arc Testnet in this environment (indexer `eth_blockNumber` to :8545 fails until Anvil is up).
- No Docker/Postgres daemon here. SQLite is the local proof. `pg-smoke` not re-run.
- R2/S3 is env-hooked; local disk fallback.
- Refundable launch bond is **FUTURE** — not collected.
- `LaunchPricing.sol` library remains unused (legacy). Factory uses `LaunchAuthorization`.
- `seed-bonding.ts` still needs a full LaunchAuthorization re-sign to launch against a live Anvil.
- Local tests set Launch Signer = pricing key. Guardian can rotate them apart. Production must.
- Production accepts **verified** Arc v4 addresses only — none hardcoded.
- Turnstile is skipped when `REACTOR_ENV=LOCAL` and no `TURNSTILE_SECRET`.
- Mainnet (5042) remains disabled.

Mainnet blocked pending Codex + audits + KMS/Safe rehearsal.
