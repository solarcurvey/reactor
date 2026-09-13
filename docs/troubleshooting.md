# Troubleshooting

> Fail closed. The API will not invent dust floors, unsigned launches, or static PROD dollars.

## Quote / trade

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `ok: false`, no `tx` | Preview failed, dust, or malformed `plannedHops+1` | Do not set `minOut` 0/1. Recheck token, side, `amountIn`. See [Quoting](/docs/quoting) |
| Route “unavailable” | Sim fail, unproven venue, or cycle | Only proven kinds. Max 3 hops |
| SELL reverts first hop | `minQuoteOut` in the wrong units | `minQuoteOut` is **quote**, not tokenIn |
| Nested ticket looks “cheap” | UI summed ZEC + ZCAT raw fees | Render each `feeLegs[]` in that hop’s decimals; use `aggregateProtocolImpactBps` |
| JSON **413** | Body over 16KiB (hard 64KiB) | Shrink the POST. Chunked bodies count |
| Buy/sell reverts `ReadyLocked` | Instant is frozen | Wait for `graduate` |

## Launch

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `403` + `CHALLENGE` | Turnstile required | Solve the widget. CHALLENGE ≠ ALLOW |
| CHALLENGE forever after a real token | You are over rate / issuance bucket | Wait. ELEVATED/ATTACK still ALLOW under caps |
| `SIGNER_STORE_UNAVAILABLE` **503** | Isolated signer durable store down | Outage, not a bypass. Do not inline-sign in PROD |
| `WrongParams` on Fair | Signature hashed `FAIR_V1` instead of resolved params | Hash `fairCurveConfig(supply, decimals, duration, auctionBps, minRaise)` |
| `TickerUnavailable` | 24h lock held by another token | Wait for expiry. Reserved names (`CORE`, `USDC`, …) never launch |
| Non-$1 launch refused | Valuation consensus missing / stale / deviant | Check `/pricing/health`. EURC is not $1 |
| Dev Buy reverts | Token-out would exceed **5%** | Lower the buy. No silent clip |
| Image upload fails | sharp missing, over 2MB, or PROD R2 unset | `pnpm approve-builds`, then retry. Fail closed |

## Indexer / board

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| FDV looks like 1B × price | Client used `tokens.supply` | Use `current_supply` / `fdv_usd6` |
| Keyset repeats / skips oddly | `cursor_ts` is the sort key | Pass `cursor_ts` + `cursor_token` with the **same** `sort` |
| Candles overlap pages | Inclusive `before` | `before` / `after` are exclusive |
| Charts disagree with wallet | Indexer lag | Onchain truth wins |

## Keeper / Guardian

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Standby is broadcasting | Split-brain (should not) | Lease fence must refuse. Check `leader_locks` |
| `leader lease lost — refuse broadcast` | TTL expired without renew | Expected fail-closed. Next loop may acquire |
| Quote not launch-eligible after `register` | No price providers | Configure `price-providers.json`, confirm `/pricing/health` |
| Mainnet Keeper send | Disabled | Chain **5042** is hard-blocked |

See [FAQ](/docs/faq), [Admission](/docs/admission), [Quoting](/docs/quoting), [Local demo](/docs/local).
