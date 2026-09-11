# BUILD REPORT — REACTOR production product + ops stack

**Status:** Consumer/ops production slice on the frozen protocol. Local Anvil 5042002 only.  
**Not audited. Not mainnet. Arc Public Testnet not claimed.**  
**HEAD parent:** `890cac9` (final security patch). Architecture unchanged except valuation correctness (parent-only USD rejected).

## This HEAD

| Item | Value |
| --- | --- |
| Branch | `cursor/prod-indexer-ops-921c` |
| Parent | `890cac9` |
| Intent | Postgres indexer + quote API + isolated signer + SAFE genesis completeness + Stonk-like UI |
| Solidity | Scripts + `GenesisVerify.verifyFullyWired` only. No hook / fee / curve / split change. |
| Mainnet | **Blocked** pending Codex + audits + KMS/Safe/rehearsal |

## What shipped

1. **Postgres production data model** — 22 tables + indexes. SQLite for local only (`DATABASE_URL=postgres://…` switches dialect). Advisory locks for keeper leader election.
2. **Canonical `price_quote_x18`** — same unit on bonding and v4. OHLCV 1m/5m/15m/1h/4h/1d with gap-fill so charts continue across graduation.
3. **ONE ValuationService** — recursive CAT→ZCAT→ZEC→USD with ancestry. Missing `priceInParentX18` is **unpriced**, not a copy of parent USD.
4. **External pricing adapters** — multi-source median + staleness/deviation + Arc sanity. Degraded → no launch signatures / pause material Top-10. Trading continues. No Solidity oracle.
5. **Durable RouteGraph** — `route_venues` stores proven official pools only. Keeper no longer invents hopViaUsdc quote/USDC edges.
6. **`POST /quote`** — BUY/SELL (+ maintenance kinds reserved). Per-hop amounts/minOuts, each official 3.5% listed separately, expiry, tx params.
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

## Tests

Run on this branch (see commit after forge/ts):

```
pnpm --filter indexer test     # keeper minOut + persist + schema + quote/keys + routes + valuation + prices
npx tsx apps/web/src/lib/top10.test.ts
npx tsx apps/web/src/lib/marketdata.test.ts
cd contracts && forge fmt && forge build && forge test
```

Expected: existing forge suite plus new SafeGenesis key-isolation tests. Valuation tests now require nested price product (CAT = $0.50, not ZEC $50).

## Honest gaps

- No live Arc Testnet txs. No public mainnet.
- `sharp` is optional; without it, media validates and stores original bytes (webp if already webp).
- R2/S3 PUT is env-stubbed; local disk + `MEDIA_CDN_BASE` is the working path.
- Quote API maintenance/TOP10/CORE kinds return a reserved error — Keeper still simulates via existing preview fns.
- Homepage quote symbols depend on indexer `quote_assets` refresh (RPC) or fixtures.
- Token-detail still reads some wallet/claim state from chain (correct; balances are onchain truth).
- Playwright capture screenshots need a running web + `NEXT_PUBLIC_REVIEW_FIXTURES=1`.
- Postgres is implemented and untested against a live `postgres` in this environment (SQLite is the local proof).
- Keeper still writes a heartbeat JSON for the watchdog; jobs themselves are SQL.
- Mainnet remains blocked: BUSL v4-core, no PoolManager on 5042, no audit, no KMS/HSM, no Safe rehearsal.

## Not built (by brief)

Social, NFTs, governance, staking, perps, referrals, native app.
