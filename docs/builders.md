# Build a terminal

> Integrate as a client, not a fork. Protocol **{{protocolVersion}}**. Factory **{{factoryVersionLabel}}**. Not audited.

Talk to the public indexer. Do not scrape Factory logs in the UI process. Do not call the isolated Launch Signer from a public host. Do not invent hops, official 0.30% pools, or `minOut` 0/1.

## Integration order

1. **Discover** — `GET /markets` (global `q`, `board` chips, keyset + NUMERIC sorts). Pass `next_cursor.cursor_ts` + `cursor_token` with the **same** `sort`; `cursor_ts` is `updated_ts` / `volume_24h_usd6` / `price_usd6`. Do not filter the first page in the client. Keyset is not a frozen snapshot: a row inserted ahead of the cursor is omitted from later pages; already-returned rows are not repeated. One market: `GET /markets/:token`. Token page: `GET /page/token/:token`. Quote picker: `GET /quote-assets`. Do not scrape factory logs in the UI process. See [Read path performance](/docs/perf). Official Top-10 is `GET /top10` (indexer ValuationService snapshot, 15m TTL), not a Factory walk.
2. **Quote** — `POST /quote`. Operator policy runs first (connected wallet + trusted geo). Use the ticket. One `UserRouteQuoter` call per candidate; hops, `feeLegs[]`, and SELL `minQuoteOut` are bound to the `pickBest` winner. Render each `feeLegs[]` entry in that hop’s quote asset/decimals (or show only `aggregateProtocolImpactBps`). Do not invent hops. Do not add raw fee amounts across ZEC and ZCAT. Do not mix another candidate's preview onto the selected path. Do not set `minOut` to 0 or 1. Do not derive SELL `minQuoteOut` from tokenIn. JSON body is capped at **16KiB** default / **64KiB** hard max (413 if over, including chunked).
3. **Launch** — `POST /launch/authorize` (operator policy → admission + ALLOW receipt + isolated sign). `@reactor/sdk` `authorize` does this. Never call the isolated signer from a public host. Same JSON cap. Policy 403/503 means no signature.
4. **Media** — `POST /upload` (operator policy via recovered wallet proof, then stream 2MB, sharp, SigV4 remote). Store the returned `publicUrl`. Object key is `m/<id>.webp` (matches `/m/<id>.webp`). No base64 onchain. Do not render creator image/name/description as HTML. URL / media allowlists: [Browser security](/docs/web-security).
5. **Live** — `GET /stream` SSE. Patch cached board / token-page rows; do not `invalidateQueries` the board on every print. Named events (`core`, `burn`, `top10`, …). First `hello.head` marks history. Reconnect with `?after=` / `Last-Event-ID`; do not treat a later `hello.head` as a new cutoff. Official UI toasts only committed CORE executes and `Top10Buy`, keyed by `(chainId, tx, logIndex, eventKind)`.

## Proven venues only

| Kind | Meaning | 3.5% |
| --- | --- | --- |
| `OFFICIAL_REACTOR_V4` | Official hook pool | Yes |
| `EXTERNAL_V4_HOOKLESS` | Hookless external v4 | No |
| `BONDING_CURVE` | Instant curve | Yes, on executed quote |

The planner does **not** recreate a generic 0.30% hookless pool. Maintenance (Keeper) uses a **separate** fee-exempt planner (`planFeeExemptRoute` + ProtocolV4Adapter). Do not reuse the user quoter for vault jobs.

## LaunchAuthorization

EIP-712 binds factory, Factory version, creator, quote, mode, ticker, name, metadata hash, `virtualQuote0`, `curveConfig`, `authId`, deadline, chain. `verifyingContract` is the **TickerRegistry**.

Fair hashes resolved sale params. Instant keeps `INSTANT_CURVE_V1`. Receipt `launchConfigHash` must match or the signer burns the receipt and refuses.

TTL is **30 minutes**. Replay is digest-level (`TickerRegistry.usedAuthorization`). No serial quote nonce. Concurrent same-quote launches use unique `authId`.

CHALLENGE ≠ ALLOW. `@reactor/sdk` `ReactorClient.authorize` posts the public indexer route only.

## Packages

| Package | Version | Role |
| --- | --- | --- |
| `@reactor/core` | {{coreVersion}} | Constants, routes, valuation, admission helpers. Signed-job `MaintenanceJob` lands with draft **#54**, not this handbook. |
| `@reactor/sdk` | {{sdkVersion}} | `ReactorClient` (`baseUrl`): `authorize`, `admit`, `markets`, `ticker`, `stream` |
| `@reactor/sanctions` | {{protocolVersion}} | Exact official-list digital-currency address `screen()` (not compliance; not hop attribution) |

`@reactor/core` exports `planCandidates`, `pickBest`, `applyMinOuts`, `ValuationService`, `consensusUsd6`, `launchBlockedByValuation`, `evaluateAdmission`, `fairCurveConfig`, `launchConfigHash`, `INSTANT_CURVE_V1`. External USD is a configured provider registry + consensus — not a separate ZEC pricer.

`ReactorClient` takes `{ baseUrl, apiKey? }`. `apiKey` is the partner `x-partner-key` on `/launch/admit` only. There is no `indexer` constructor field.

Protected write routes (`POST /quote`, `/upload`, `/launch/*`) fail closed on a stale or missing official-list snapshot. `GET /markets` and other public reads are not gated. See [Sanctions ops](/docs/sanctions-ops).
Hosted write assistance (`POST /quote`, `/launch/authorize`, `/upload`) may return `deny` / `unavailable` with a public `reason`. Send `x-reactor-wallet-proof` from `GET /operator-policy/challenge` (EIP-191). Do not send browser country / IP / “clear” / claimed-wallet flags as authority. Do not expect the UI to hide `GET /markets`. See [Restricted access](/docs/restricted-access).

## Client rules that will get you rekt

- Do not stitch a fatter raw `amountOut` onto a differently scored path.
- Do not format `holders + flywheel + core` across different quote decimals.
- Do not treat indexer `fdv_usd6` as onchain truth. It uses burn-adjusted `current_supply` (tracks `totalSupply()`, not ≡).
- Do not claim Top-10 is a trustless oracle.
- Do not ship `minOut` 0 or 1 “to be safe.” The API will not.

Exact-address screening: `GET /sanctions/screen` returns `blocked` / `clear` / `unavailable` plus dataset version. Treat `unavailable` as fail-closed, never as clear. [Address screening](/docs/sanctions). `@reactor/sdk` does **not** evaluate geo policy. Jurisdiction decisions are server-side. Do not copy ISO deny lists into a terminal. See [Geo policy](/docs/geo-policy). Write-path enforcement is [Operator policy](/docs/operator-policy). Protected write routes (`POST /quote`, `/upload`, `/launch/*`) fail closed on a stale or missing official-list snapshot. `GET /markets` and other public reads are not gated. See [Sanctions ops](/docs/sanctions-ops).

See [API](/docs/api), [SDK](/docs/sdk), [Examples](/docs/examples), [Quoting](/docs/quoting), [Events](/docs/events), [Markets](/docs/markets), [Observability](/docs/observability), [UI QA](/docs/qa), [Operator policy](/docs/operator-policy).

## Production UI release gate

CI runs Playwright against **`next build` + `next start`** (not `next dev`) on Chromium, Firefox, WebKit, iPhone-class, and narrow-Android viewports with a deterministic EIP-1193 wallet fixture. Chromium also loads a MetaMask/Rabby-style unpacked MV3 extension (connect/confirm through a real prompt). No mainnet keys. No live Anvil. The mock indexer answers the #50 indexed reads (`/quote-assets`, `/markets/:token`, `/page/token/:token`) so the production build does not 404 those hops. Journeys cover BUY/SELL, nested USDC BUY+SELL (`UserRouteExecutor` calldata), bonding InstantCurve, graduated v4, Instant launch, rewards claim, Dev Buy, wrong-chain, user-rejected txs, lock/switch/disconnect, revert, allowance, quote TTL, and dropped receipts. Unexpected browser `console.error` / unhandled `pageerror` fail the suite (shared fixture on every release-gate page).

The gate is the **full-only** job `e2e-release-gate` on `.github/workflows/ci.yml` (Refs #69 / #73). Do not add a second `push` + `pull_request` workflow.

```bash
pnpm test:e2e:release
```

This is a UI/release gate, not an onchain proof. Live local demo remains `pnpm --filter indexer demo`. See `TESTING.md` §41.
