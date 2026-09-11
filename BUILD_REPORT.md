# BUILD REPORT — REACTOR production product + ops stack

**Status:** Consumer/ops production slice on the frozen protocol. Local Anvil 5042002 only.  
**Not audited. Not mainnet. Arc Public Testnet not claimed.**  
**HEAD parent:** `890cac9` (final security patch). Architecture unchanged except valuation correctness (parent-only USD rejected).

## This HEAD

| Item | Value |
| --- | --- |
| Branch | `cursor/candles-keeper-pg-921c` → merge `main` |
| Parent | `b590c8d` (slice parent `890cac9`) |
| Intent | Postgres indexer + quote API + isolated signer + SAFE genesis completeness + Stonk-like UI |
| Solidity | Scripts + `GenesisVerify.verifyFullyWired` only. No hook / fee / curve / split change. |
| Mainnet | **Blocked** pending Codex + audits + KMS/Safe/rehearsal |

## What shipped

1. **Postgres production data model** — 22 tables + indexes. SQLite for local only (`DATABASE_URL=postgres://…` switches dialect). Advisory locks for keeper leader election.
2. **Canonical `price_quote_x18`** — same unit on bonding and v4. OHLCV 1m/5m/15m/1h/4h/1d with gap-fill so charts continue across graduation.
3. **ONE ValuationService** — recursive CAT→ZCAT→ZEC→USD with ancestry. Missing `priceInParentX18` is **unpriced**, not a copy of parent USD.
4. **External pricing adapters** — multi-source median + staleness/deviation + Arc sanity. Degraded → no launch signatures / pause material Top-10. Trading continues. No Solidity oracle.
5. **Durable RouteGraph** — `route_venues` stores proven official pools only. Keeper no longer invents hopViaUsdc quote/USDC edges.
6. **`POST /quote`** — BUY/SELL plus MAINTENANCE / TOP10 / SELFBURN / CORE via the same RouteGraph planner (fee-exempt protocol/hookless edges). Per-hop amounts/minOuts, each official 3.5% listed separately on user tickets.
7. **Frontend quote API only** — trade panel does not wallet-sim intermediate hops.
8. **Keeper jobs in SQL** — not `keeper-state.json` when the store is up. Advisory-lock leader. Distinct Guardian / Keeper / Pricing keys enforced.
9. **Isolated pricing signer** (`apps/indexer/src/pricing-signer.ts` :43149). Next proxies and **fails** if down. No Anvil key in Next. LOCAL-only anvil key on the signer process.
10. **SAFE_GENESIS** — full 28-op Guardian MultiSend (setPricingSigner through binds, vaults, seal, activateLaunch, pauseLaunches last). `verifyFullyWired` proves deployer≠Safe and pricing≠keeper. Local test covers this.
11. **Media** — magic-byte validate, optional sharp resize/WebP, short `/m/{id}` URI. No base64 onchain. R2/S3 env hooks present; local disk fallback.
12. **SSE** `/stream` + EventSource reconnect/health fallback.
13. **Homepage** — `GET /markets` pagination/filter/sort. Zero per-token RPC. Ops removed from public nav. Dense rows + live badge.
14–17. Token terminal, Reactor, CORE+vesting, quote ecosystem, search, 390-friendly table. Review fixtures carry price/vol.
18. **Ops** — `OPS_TOKEN` / `x-ops-token`. P0/P1 alerts table. Dual RPC via `RPC_URL_FALLBACK`. `request_id` on indexer responses.

CORE liquidity doc marked **APPROVED WORKING MAINNET CONFIG — SUBJECT TO AUDIT** for the frozen ~$100k book.

## Follow-up (this HEAD, parent `b590c8d`)

Closed DoD leftovers on the frozen protocol. **Zero Solidity.**

1. **Token terminal chart** uses `GET /candles/:token?interval=` (1m/5m/15m/1h/4h/1d). Gap-filled continuous series. Sparse badge when fewer than 3 real prints. `/swaps` is the trade tape only.
2. **Keeper maintenance** plans through `planFeeExemptRoute` (same RouteGraph as `/quote`). Official live factory venues are synced into `route_venues` — hopViaUsdc pools are still never invented. Job rows persist as `MAINTENANCE_SETTLEMENT` / `TOP10_BUY` / `SELFBURN` / `CORE_BUYBACK`.
3. **Postgres smoke** — `docker-compose.yml` (postgres:16 on :54329) + `pnpm --filter indexer pg-smoke`. **Not run here:** this environment has no Docker/Postgres daemon. SQLite remains the local proof.

## Tests (follow-up)

| Suite | Result |
| --- | --- |
| `pnpm --filter indexer test` | ok including maintenance planner + SQL job kinds |
| Web top10 + marketdata | ok |
| Playwright interactive + capture | **6 passed / 0 failed** |
| Foundry | not re-run (no Solidity) |

## Tests (prior pass on `b590c8d`)

| Suite | Result |
| --- | --- |
| `pnpm --filter indexer test` | 7/7 ok (keeper minOut, persist, schema/store, quote/keys, routes, valuation, prices) |
| `npx tsx apps/web/src/lib/top10.test.ts` | 7/7 ok (CORE skip, material unvalued pause, weights) |
| `npx tsx apps/web/src/lib/marketdata.test.ts` | ok |
| Playwright interactive + smoke + capture | **10 passed / 0 failed** (5 interactive, 4 smoke, 1 capture) |
| `cd contracts && forge test` | **301 passed, 0 failed, 1 skipped** (`SafeGenesisTest` = 8). Foundry 1.8.1, via_ir. |

Valuation tests require the nested product (CAT = $0.50, not ZEC $50). Accidental tree-wide `forge fmt` was **reverted**; no hook / fee / curve / split Solidity landed in this pass.

New token-terminal OHLCV screenshots:

- `review/token-terminal-1440.png` sha256 `31feb0fb7b8fc27e3ac6533d7c2747eb8b2d0cb7ce01cff3c76c1afb29b4bb4f`
- `review/token-terminal-390.png` sha256 `a9e26555b6000f32f4a5a88dfa24d2c02c52c02c2e6900455e79cef4b6483264`

## Honest gaps

- No live Arc Testnet txs. No public mainnet.
- `sharp` is optional; without it, media validates and stores original bytes (webp if already webp).
- R2/S3 PUT is env-stubbed; local disk + `MEDIA_CDN_BASE` is the working path.
- Token-detail still reads some wallet/claim state from chain (correct; balances are onchain truth).
- Postgres dialect + `pg-smoke` are implemented; **this VM has no Docker**, so live Postgres was not executed. Run `docker compose up -d postgres` then `DATABASE_URL=postgres://reactor:reactor@127.0.0.1:54329/reactor pnpm --filter indexer pg-smoke` locally.
- Keeper still writes a heartbeat JSON for the independent watchdog; jobs themselves are SQL.
- Homepage “Review fixtures — not on-chain” banner stays on while seeded `0x1111…` rows are present.
- Mainnet remains blocked: BUSL v4-core, no PoolManager on 5042, no audit, no KMS/HSM, no Safe rehearsal.

## Not built (by brief)

Social, NFTs, governance, staking, perps, referrals, native app.
