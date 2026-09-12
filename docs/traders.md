# For traders

> Exact-in. Nonzero `minOut`. Incomplete fills revert. Not audited. Chain **5042002**.

Official REACTOR pools are Uniswap v4 with a **0% LP fee**. You pay a **3.5% quote-side** hook charge: **2% holders / 1% Top-10 / 0.5% CORE**. Transfer has **zero tax**.

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

## Rewards

Holder rewards are **same-quote**, no staking. Claim on the token page. When Rewards `eligibleSupply==0`, the 2% goes to SelfBurn (not the first remaining holder).

CORE never ranks in Top-10. Ranks are an **offchain API** — contracts check structure only. See [Trust](/docs/trust).

Continue: [Quoter](/docs/quoting) · [Fees](/docs/fees) · [Markets API](/docs/markets) · [Valuation](/docs/valuation).
