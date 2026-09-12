# Build a terminal

Integrate as a client, not a fork. Protocol **0.3.3**. Factory **V1**.

## Integration order

1. **Discover** — `GET /markets` (keyset + NUMERIC sorts). Pass `next_cursor.cursor_ts` + `cursor_token` with the **same** `sort`; `cursor_ts` is `updated_ts` / `volume_24h_usd6` / `price_usd6`. Keyset is not a frozen snapshot: a row inserted ahead of the cursor is omitted from later pages; already-returned rows are not repeated. Do not scrape factory logs in the UI process. Official Top-10 is `GET /top10` (indexer ValuationService snapshot, 15m TTL), not a Factory walk.
2. **Quote** — `POST /quote`. Use the ticket. One `UserRouteQuoter` call per candidate; hops, `feeLegs[]`, and SELL `minQuoteOut` are bound to the `pickBest` winner. Render each `feeLegs[]` entry in that hop’s quote asset/decimals (or show only `aggregateProtocolImpactBps`). Do not invent hops. Do not add raw fee amounts across ZEC and ZCAT. Do not mix another candidate's preview onto the selected path. Do not set `minOut` to 0 or 1. Do not derive SELL `minQuoteOut` from tokenIn. JSON body is capped at **16KiB** default / **64KiB** hard max (413 if over, including chunked).
3. **Launch** — `POST /launch/authorize` (admission + ALLOW receipt + isolated sign). `@reactor/sdk` `authorize` does this. Never call the isolated signer from a public host. Same JSON cap.
4. **Media** — `POST /upload` (stream 2MB, sharp, SigV4 remote). Store the returned `publicUrl`. Object key is `m/<id>.webp` (matches `/m/<id>.webp`). No base64 onchain. Do not render creator image/name/description as HTML. URL / media allowlists: [Browser security](/docs/web-security).
5. **Live** — `GET /stream` SSE for tape / board invalidation. Named events (`core`, `burn`, `top10`, …). First `hello.head` marks history. Reconnect with `?after=` / `Last-Event-ID`; do not treat a later `hello.head` as a new cutoff. Official UI toasts only committed CORE executes and `Top10Buy`, keyed by `(chainId, tx, logIndex, eventKind)`.

## Proven venues only

| Kind | Meaning | 3.5% |
| --- | --- | --- |
| `OFFICIAL_REACTOR_V4` | Official hook pool | Yes |
| `EXTERNAL_V4_HOOKLESS` | Hookless external v4 | No |
| `BONDING_CURVE` | Instant curve | Yes, on executed quote |

Maintenance (Keeper) uses a **separate** fee-exempt planner (`planFeeExemptRoute` + ProtocolV4Adapter). Do not reuse the user quoter for vault jobs.

## LaunchAuthorization

EIP-712 binds factory, Factory version, creator, quote, mode, ticker, name, metadata hash, `virtualQuote0`, `curveConfig`, `authId`, deadline, chain. `verifyingContract` is the **TickerRegistry**.

Fair hashes resolved sale params. Instant keeps `INSTANT_CURVE_V1`. Receipt `launchConfigHash` must match or the signer burns the receipt and refuses.

## Packages

| Package | Version | Role |
| --- | --- | --- |
| `@reactor/core` | 0.3.3 | Constants, routes, valuation, admission helpers |
| `@reactor/sdk` | 0.3.3 | `ReactorClient.authorize`, quote ticket helpers |

See [API](/docs/api), [SDK](/docs/sdk), [Examples](/docs/examples), [Quoting](/docs/quoting), [Events](/docs/events).
