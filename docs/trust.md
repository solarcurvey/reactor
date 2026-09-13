# Trust assumptions

> This repo is **not audited**. Do not deploy to Arc Mainnet (5042). Top-10 is not a trustless oracle.

Treat every offchain number as **trusted computation** unless a contract check is named below. Onchain balances and fees win over the indexer.

## The list

1. **Top-10 ranks are an offchain API.** Indexer ValuationService + persisted `current_supply` produce `GET /top10` (schema **v11**). A snapshot older than 15 minutes is not served or submitted. Empty `current_supply` after v9 pauses the epoch (no mint-supply fallback). Contracts check structure only (length, weights, CORE exclusion, graduated, no dupes). They do not compute ranks. A compromised indexer or job signer can submit a legal-looking epoch that is economically wrong. Relayers / CRE cannot substitute ranking.
2. **Launch Signer prices non-$1 quotes via ValuationService** (multi-source consensus). Not an onchain oracle. Admission + receipt required. Provider outage or deviation refuses the signature. The isolated signer **fail-closes** if the durable store is down — it must not skip receipt consume or the signed-auth issuance bucket.
3. **Indexer charts, 24h USD, and candles can lag or be wrong.** Onchain truth wins. A tick does not leave events without a cursor (or a cursor without those events): protocol logs, token burn journal / `current_supply` writes, and `indexer_state` advance in one transaction. That is crash consistency, not an oracle. Bounded `totalSupply()` reconcile can still repair `current_supply`; it does not replace the journal.
4. **Guardian can pause, quarantine, rotate signer, permanently lock tickers.** Cannot steal locked LP or change 2/1/0.5. Compromise halts the product; it does not rewrite economics. See [Guardian](/docs/guardian).
5. **`AutomationGateway` is the designated Keeper.** Decision service + job signer choose ranks/routes; relayers (CRE / Gelato / any EOA) only deliver the signed job. One lease (`leader_locks.lease_until` in **milliseconds**, `BIGINT`) with renew + acquire-generation fence (TTL is failover, not a tick budget). Simulated minOut is bound in the job. Cannot configure. CRE does not decentralize Top-10. See [Keeper](/docs/keeper) · [Automation](/docs/automation).

6. **Cloudflare Turnstile + issuance bucket are offchain.** A bypassed LOCAL env is not production. Store unavailability is an outage (503), not a throttle bypass.
7. **Funding-cluster is a heuristic** (network + optional first funder). Not KYC, not chain analysis.
8. **Arc Testnet PoolManager is not deployed.** Local demo uses official v4-core under BUSL (non-production).
9. **R2/S3 and the external price registry are fail-closed in PROD.** Missing providers or a static-only config disable those quote launches. Accepted/rejected marks are persisted for the watchdog.
10. **Public JSON POSTs are stream-capped** at 16KiB default / 64KiB hard max (Content-Length and chunked). Upload is 2MB. Limits stop unbounded buffering; they are not a DoS proof.
11. **Uniswap v4-core is trusted to behave as specified.** BUSL-1.1 allows this PoolManager deploy only as non-production until the Change Date / Additional Use Grant.
12. **Guardian does not list fee-on-transfer or rebasing quotes.** Listing one is operational risk. Accrue measures actual received and reverts on shortfall.
13. **Arc dual-decimal USDC.** Native gas is 18 decimals; protocol USDC ERC-20 is 6. Contracts use the ERC-20 interface only. Mixing `address.balance` with `USDC.balanceOf` by 1e12 is a client bug.
14. **Client error telemetry is optional operator infrastructure.** Events are redacted (no keys, mnemonics, signatures, Turnstile, cookies). A configured Sentry DSN shares that redacted text with Sentry. Release SHA **plus** `reactorEnv` / `chainId` / `buildTimestamp` identify the build; `traceId` / `x-request-id` join a user-visible failure to BFF and indexer logs. `POST /api/telemetry` 429 is ingest backpressure, not a user-visible outage. It is not an oracle. See [Observability](/docs/observability).
15. **Token metadata is untrusted in the browser.** Names, tickers, descriptions, social URLs, and images are never rendered as HTML. URL schemes are allowlisted (`https:` / loopback `http:`). Images are first-party `/m/<id>.webp` or `/icons/…` only. Production CSP is a per-request nonce (`script-src` has no `'unsafe-inline'`). Wallet writes ignore metadata and indexer calldata; the official chain is required. Secrets are not `NEXT_PUBLIC_*`. See [Browser security](/docs/web-security). Admission DENYs `javascript:` / `data:` / HTML names before sign. The UI still sanitizes on read.
16. **Repository visibility is an operator decision.** The tree may stay private. Public-fork Actions must not receive repository secrets or a writable `GITHUB_TOKEN`. Do not publicize without founder instruction. Residual pre-rewrite dangling SHAs are accepted; Support purge/GC is not a #72 AC. See [Repo publicization](/docs/publicization).
17. **Indexed board / `/page/token` aggregation is display-only.** Swap tickets remain `POST /quote` (30s TTL). Canonical Multicall3 is probed, not trusted as always present on Arc. See [Read path performance](/docs/perf).
18. **The consumer UI fails visible** on indexer / RPC / `POST /quote` outages (including 429/413/5xx, stale/expired tickets, no route). A down indexer is not an empty board. A failed quote is not a 0/1 `minOut` ticket. Pricing and upload fail closed. SSE reconnect must not duplicate toasts. Review/QA-build `?inject=` is ignored in production. See [UI QA](/docs/qa).
19. **Exact official-list address screening is not OFAC compliance.** `@reactor/sanctions` matches canonical digital-currency addresses from Treasury/OFAC HTTPS XML only. Missing or stale data is `unavailable`, never `clear`. No hop / cluster / exposure product. `GET /sanctions/screen` is the lookup API; write/authorization gating is operator policy (#62). See [Address screening](/docs/sanctions).
20. **Geo / jurisdiction policy is an offchain server decision** (`evaluateRequestGeo` → ALLOW / DENY / UNKNOWN). Production country/region come only from a verified edge HMAC (`GEO_EDGE_SECRET`). Browser `CF-IPCountry` / `X-Country` / `X-Forwarded-For` are not trusted. LOCAL uses fixture codes (`FX` / `FY`) and cannot load the production deny revision. VPN/Tor labels are best-effort only. Oblast-only Donetsk/Luhansk (`UA-14` / `UA-09`) is UNKNOWN, not a whole-oblast DENY ([FAQ 1009](https://ofac.treasury.gov/faqs/1009)). This is **not** a legal opinion, **not** OFAC-compliance, and **not** address screening (#61). HTTP enforcement is operator policy (#62). See [Geo policy](/docs/geo-policy).
21. **Operator policy (sanctions / geo) is offchain and REACTOR-operated only.** `POST /launch/admit`, `POST /launch/authorize`, the isolated launch signer, `POST /quote`, `POST /upload`, and the Next `POST /api/launch-pricing` BFF fail closed on a blocked **recovered** wallet, blocked geo, missing/invalid wallet proof, or stale/unavailable required policy. The screened subject is the EIP-191 signer of a server challenge — not `body.wallet` / `x-reactor-wallet`. Browser `sanctionsClear` / country / IP flags are ignored. `GET /operator-policy/status` is the minimized public decision for #65 UX (same reasons; no internals). The launchpad `/restricted` state and disabled Confirm / Launch / Quote CTAs are UX over that server decision. They do not pause Factory / Router / Curve / Hook and do not censor permissionless chain reads. The browser never receives raw IP, screening-entry metadata, list UIDs, or dataset hashes. Address screening is **#61** (merged **#66**); trusted geo is **#63** (merged **#67**); enforcement is **#62** (merged **#68**); official-list freshness is **#64** (merged **#70**). A stale or missing snapshot (7-day SLA) is the public “temporarily unavailable” state — never treated as clear. Public `GET` market/docs paths (including `/sanctions/screen`) are not blocked for cosmetic denial. Immutable contracts remain callable onchain — this is not a protocol pause and not a legal/OFAC-compliance opinion. See [Operator policy](/docs/operator-policy), [Restricted access](/docs/restricted-access), and [Sanctions ops](/docs/sanctions-ops).
22. **Official-list freshness is fail-closed on operated writes.** The 7-day SLA (`ofac-official-list-v1`) is offchain. Stale or missing data is never treated as clear. Refresh is scheduled + at startup; a bad/partial fetch keeps last-known-good. Gated identity is the merged #62 recovered EIP-191 wallet (`operator-policy.ts`), not `body.wallet` / `x-reactor-wallet`. Fixture refresh is LOCAL/test-only — STAGING/TESTNET/PROD require the official #61 source. Audit lines hash the recovered wallet and drop raw IP, signatures, and request bodies. There is no automated override on a user complaint. [Sanctions ops](/docs/sanctions-ops) · [Runbook](/docs/sanctions-runbook) · [Incident response](/docs/incident-response).

## What is onchain truth

- Token balances, `totalSupply`, burns via `burn()`
- Official pool reserves in `PoolManager`
- Hook fee take and vault accruals
- Ticker locks and used authorization digests
- Instant `ready` / graduate
- Top-10 **structure** of a submitted epoch (not the USD that produced it)
- Guardian pauses and adapter allowlists

## What is not onchain truth

- `/markets` FDV, 24h volume, candles
- Top-10 membership and weights (`GET /top10` snapshot)
- External quote USD (ZEC, WBTC, …)
- Turnstile / admission ALLOW
- Indexer SSE events
- Keeper `minOut` simulations

`fdv_usd6` uses `tokens.current_supply`, which **tracks** remaining `totalSupply()` after `burn()`. It is not claimed identical at every instant.

## Fail-closed surfaces

| Surface | On failure |
| --- | --- |
| Isolated signer store down | **503** `SIGNER_STORE_UNAVAILABLE` — no signature |
| Valuation consensus missing / stale / deviant | Refuse launch auth; pause material Top-10; trading continues |
| Quote preview fail / dust | `ok: false` — no calldata, no `minOut` 0/1 |
| Keeper lease lost mid-tick | Refuse further broadcasts |
| PROD missing Turnstile / Anvil `#0` signer | Process refuses to start |
| PROD missing R2/S3 | Uploads fail closed |

See [Security](/docs/security), `THREAT_MODEL.md`, `AUDIT_HANDOFF.md`.
