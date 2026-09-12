# For traders

> Exact-in. Nonzero `minOut`. Incomplete fills revert. Not audited. Chain **5042002**.

Official REACTOR pools are Uniswap v4 with a **0% LP fee**. You pay a **3.5% quote-side** hook charge: **2% holders / 1% Top-10 / 0.5% CORE**. Transfer has **zero tax**.

You do not pick the fee. You do not pick the curve. You pick a token, a side, an exact input, and slippage. The UI (or your bot) must use a `POST /quote` ticket. Do not invent hops.

## What you pay

On an official hop the hook takes **3.5% of that hop’s quote notional** (executed gross). It is not an LP fee and not a token-level sell tax.

| Slice | Where it goes |
| --- | --- |
| 2.00% | Holders in the **same quote** (Rewards) or SelfBurn (Standard, or Rewards when `eligibleSupply==0`) |
| 1.00% | Top-10 flywheel |
| 0.50% | CORE buy+burn |

A nested path can charge 3.5% on **each** official hop. Two official hops compound to **6.88%** before slippage (`aggregateProtocolImpactBps = 688`). Hookless external hops are not a REACTOR charge. See [Nested fees](/docs/fees).

Fair auction bids charge **0%**. The 3.5% starts after one migration onto the official pool.

## How a trade is quoted

1. The UI (or your bot) calls `POST /quote` with token, side, `amountIn`, slippage, and a recovered-wallet proof (`x-reactor-wallet-proof`). The ticket `recipient` is rebound to that recovered signer. REACTOR-operated quote assistance is [policy-gated](/docs/operator-policy) (recovered wallet + trusted geo) before a ticket is returned. Public board `GET`s are not.
2. The indexer plans ≤8 candidates (≤3 hops, no cycles).
3. Each candidate is one **`UserRouteQuoter` `eth_call`** with state overrides. The indexer does not stitch per-hop sims that would need intermediate wallet balances.
4. The winner is `pickBest` on the scored previews — not independently “max raw `amountOut`”. Hop `kind` is preserved: `OFFICIAL_REACTOR_V4` / `EXTERNAL_V4_HOOKLESS` / `BONDING_CURVE`. Hops, `amountOut`, kinds, `minOut`s, `feeLegs[]`, and the terminal official/bonding result are **one** candidate. `PreviewRoute` arrays are `plannedHops + 1`.
5. Nested official legs appear in `feeLegs[]`. Each charged leg is shown in **that hop’s quote** (ZEC vs ZCAT are not added). Compound impact is `aggregateProtocolImpactBps` (6.88% for two 3.5% hops). A routed SELL ticket’s `minQuoteOut` is slipped first-leg **quote** out, not tokenIn. A failed preview is **unavailable** — never `minOut` 0 or 1.

Submit the ticket’s `tx.to` + `tx.data`. Apply your own slippage on the returned `amountOut`. Do not invent hops.

### Two sell floors (different units)

A SELL has **two** safety floors. They are not interchangeable:

| Floor | Protects | Units |
| --- | --- | --- |
| `minQuoteOut` | First official/bonding leg (token → your market quote) | Quote asset (ZEC-8, USDC-6, …) |
| `minOut` / `minFinalOut` | Final USDC you take home | USDC-6 on a nested route; the same quote if you sell direct-to-quote |

The ticket applies your slippage to each previewed amount **separately**, from the same selected candidate. `minQuoteOut` is never your launch-token size (`amountIn`). If the atomic preview fails, you get `ok: false` and no calldata — not a 1-wei floor.

USDC → nested quote → official/bonding goes through `UserRouteExecutor`. Bonding markets use `curve.buy` / `curve.sell` on the last leg (the executor-only `buyRouted` path is not a user quote).

Names, tickers, descriptions, and images on the board are **untrusted creator strings**. The UI strips HTML and will not follow `javascript:` / arbitrary image hosts. A token name cannot change the wallet `to` / recipient — Confirm is disabled on the wrong chain. See [Browser security](/docs/web-security).

`POST /quote` is hosted write assistance. When the server policy decision is deny or unavailable (including a stale or missing official-list snapshot under the 7-day SLA), the ticket is not returned and the Confirm / Quote buttons stay disabled **before** a wallet prompt. The board, charts, and tape remain readable. See [Restricted access](/docs/restricted-access) and [Sanctions ops](/docs/sanctions-ops).

## Instant vs graduated vs Fair

| Stage | Where you trade | 3.5% |
| --- | --- | --- |
| Instant bonding (not `ready`) | `InstantCurve` | Yes, on executed quote |
| Instant `ready` / frozen | **No buys or sells** until `graduate` | Terminal fees already taken on executed gross only |
| Graduated official v4 | Hooked 0% LP pool | Yes, quote-side hook |
| Fair auction window | Factory bids | **0%** |
| Fair after finalize | Official hooked pool | 3.5% |

When Instant is `ready`, the curve is frozen. Wait for `graduate`. Do not expect a buy or sell to go through.

## When a service is down

The UI **fails visible**. It does not invent a quote ticket or pretend the board is empty when the indexer is unreachable.

| Failure | What you see | What is still true |
| --- | --- | --- |
| Indexer (`GET /markets`, candles, tape, `/reactor`) | “Indexer unavailable” + Retry | Onchain balances and fills still settle |
| RPC (Anvil / Arc-compatible 5042002) | “RPC unavailable” | Onchain truth is unchanged; CORE stats and the quote registry need the node |
| `POST /quote` | “Quote unavailable” | No ticket. Never `minOut` 0 or 1 |

Review / Playwright can force those banners with `?inject=` (indexer, rpc, quote 429/413/5xx/stale/expired/noroute, pricing, upload, SSE, empty, invalid, wallet — ignored in production). See [UI QA](/docs/qa).

## Board, charts, tape

| Surface | Source |
| --- | --- |
| Homepage / search | `GET /markets` — search (`q`), `stage`, NUMERIC sort (`new` / `vol` / `price`), keyset (`cursor_ts` + `cursor_token` on that sort key) |
| Token page | `GET /page/token/:token` (market + candles + tape). Live ticket is still `POST /quote`. |
| Top-10 | Indexer `GET /top10` (ValuationService snapshot, 15m TTL). Not a Factory RPC. |
| 24h price | Latest trade **by `ts`**, not `MAX(price)` |
| 24h USD volume | ValuationService (`volume_24h_usd6`) |
| FDV / market cap | `fdv_usd6` — mark × `tokens.current_supply`, which tracks remaining onchain `totalSupply()` after `burn()` (not the initial 1B mint, not a live ≡) |
| Chart | `GET /candles/:token?interval=&limit=&before=&after=` (exclusive `before`/`after`; gap-fill ≤ `limit`, max 1000) |
| Tape | `GET /swaps/:token?limit=&before_id=` (bounded) |
| Live | `GET /stream` SSE. Bottom-right toasts fire only after the indexer commits a CORE `BuybackExecuted` / `COREBurned` or a Top-10 `Top10Buy` — not on pending txs, not on epoch submit, not on Standard SelfBurn. Dedupe is `(chainId, tx, logIndex, eventKind)`. Hover/focus pauses dismiss. |

Indexer numbers can lag or be wrong. Balances and fees are onchain. See [Markets API](/docs/markets) and [Trust](/docs/trust).

## Rewards

Holder rewards are **same-quote**, no staking. Claim on the token page. When Rewards `eligibleSupply==0`, the 2% goes to SelfBurn (not the first remaining holder).

Past rewards persist across transfers. A new holder does not inherit the previous accumulator. See [Rewards](/docs/rewards).

If a page fails to render, the **error boundary** keeps the rest of the app (nav, other routes). No funds move from that screen. Quote / trade / launch errors show a short `ref` operators can match to backend logs. See [Observability](/docs/observability).

## Top-10 and CORE

CORE never ranks in Top-10. Ranks are an **offchain API** (`GET /top10` — ValuationService + persisted `current_supply`, schema **v11**). Contracts check structure only. THE REACTOR UI (`/reactor`) proxies that snapshot plus onchain epoch events. Treat that board as trusted computation, not an oracle. Not a Factory RPC.

See [Top-10](/docs/top-10), [CORE](/docs/core), [Trust](/docs/trust).

## Honest trader limits

- Exact-out exists at the hook but is less tested in the UI. Tickets are exact-in.
- External / hookless pools of the same token may exist. They do not pay REACTOR economics.
- Sandwich / JIT on a 0% LP pool is accepted AMM risk. Set slippage you can live with.
- A `POST /quote` JSON body over **16KiB** (hard max **64KiB**) is **413**.
- If a page fails to render, the **error boundary** keeps the rest of the app (nav, other routes). No funds move from that screen. See [Observability](/docs/observability).

Continue: [Quoter](/docs/quoting) · [Fees](/docs/fees) · [Lifecycle](/docs/lifecycle) · [Troubleshooting](/docs/troubleshooting).
