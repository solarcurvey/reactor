# Build a terminal

Integrate as a client, not a fork. Protocol **0.3.2**. Factory **V1**.

## Integration order

1. **Discover** — `GET /markets` (keyset + NUMERIC sorts). Pass `next_cursor.cursor_ts` + `cursor_token` with the **same** `sort`; `cursor_ts` is `updated_ts` / `volume_24h_usd6` / `price_usd6`. Keyset is not a frozen snapshot: a row inserted ahead of the cursor is omitted from later pages; already-returned rows are not repeated. Do not scrape factory logs in the UI process.
2. **Quote** — `POST /quote`. Use the ticket. One `UserRouteQuoter` call per candidate. Do not invent hops. Do not mix another candidate's preview onto the selected path. Do not set `minOut` to 0 or 1. On SELL, submit the ticket’s `minQuoteOut` (first-leg quote units) and `minOut` (final USDC).
3. **Launch** — `POST /launch/authorize` (admission + ALLOW receipt + isolated sign). `@reactor/sdk` `authorize` does this. Never call the isolated signer from a public host.
4. **Media** — `POST /upload` (stream 2MB, sharp, SigV4 remote). Store the returned `publicUrl`. Object key is `m/<id>.webp` (matches `/m/<id>.webp`). No base64 onchain.
5. **Live** — `GET /stream` SSE for tape / board invalidation.

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
| `@reactor/core` | 0.3.2 | Constants, routes, valuation, admission helpers |
| `@reactor/sdk` | 0.3.2 | `ReactorClient.authorize`, quote ticket helpers |

See [API](/docs/api), [SDK](/docs/sdk), [Examples](/docs/examples), [Quoting](/docs/quoting), [Events](/docs/events).
