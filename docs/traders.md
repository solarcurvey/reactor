# For traders

> Exact-in. Nonzero `minOut`. Incomplete fills revert. Not audited. Chain **5042002**.

Official REACTOR pools are Uniswap v4 with a **0% LP fee**. You pay a **3.5% quote-side** hook charge: **2% holders / 1% Top-10 / 0.5% CORE**. Transfer has **zero tax**.

## How a trade is quoted

1. The UI (or your bot) calls `POST /quote` with token, side, `amountIn`, slippage.
2. The indexer plans ≤8 candidates (≤3 hops, no cycles).
3. Each candidate is one **`UserRouteQuoter` `eth_call`** with state overrides. The indexer does not stitch per-hop sims that would need intermediate wallet balances.
4. The winner is the real `amountOut`. Hop `kind` is preserved: `OFFICIAL_REACTOR_V4` / `EXTERNAL_V4_HOOKLESS` / `BONDING_CURVE`. Hops, `amountOut`, kinds, `minOut`s, and the terminal official/bonding result are **one** candidate. `PreviewRoute` arrays are `plannedHops + 1`.
5. Nested official legs appear in `feeLegs[]`. A failed preview is **unavailable** — never `minOut` 0 or 1.

Submit the ticket’s `tx.to` + `tx.data`. Apply your own slippage on the returned `amountOut`. Do not invent hops.

### Two sell floors (different units)

A SELL has **two** safety floors. They are not interchangeable:

| Floor | Protects | Units |
| --- | --- | --- |
| `minQuoteOut` | First official/bonding leg (token → your market quote) | Quote asset (ZEC-8, USDC-6, …) |
| `minOut` / `minFinalOut` | Final USDC you take home | USDC-6 on a nested route; the same quote if you sell direct-to-quote |

The ticket applies your slippage to each previewed amount **separately**, from the same selected candidate. `minQuoteOut` is never your launch-token size (`amountIn`). If the atomic preview fails, you get `ok: false` and no calldata — not a 1-wei floor.

USDC → nested quote → official/bonding goes through `UserRouteExecutor`. Bonding markets use `curve.buy` / `curve.sell` on the last leg (the executor-only `buyRouted` path is not a user quote).

## Board, charts, tape

| Surface | Source |
| --- | --- |
| Homepage / search | `GET /markets` — search, NUMERIC sort (`new` / `vol` / `price`), keyset (`cursor_ts` + `cursor_token` on that sort key) |
| 24h price | Latest trade **by `ts`**, not `MAX(price)` |
| 24h USD volume | ValuationService (`volume_24h_usd6`) |
| FDV / market cap | `fdv_usd6` — mark × `tokens.current_supply`, which tracks remaining onchain `totalSupply()` after `burn()` (not the initial 1B mint, not a live ≡) |
| Chart | `GET /candles/:token?interval=&limit=&before=&after=` (exclusive `before`/`after`; gap-fill ≤ `limit`, max 1000) |
| Tape | `GET /swaps/:token?limit=&before_id=` (bounded) |
| Live | `GET /stream` SSE |

## Rewards

Holder rewards are **same-quote**, no staking. Claim on the token page. When Rewards `eligibleSupply==0`, the 2% goes to SelfBurn (not the first remaining holder).

CORE never ranks in Top-10. Ranks are an **offchain API** — contracts check structure only. See [Trust](/docs/trust).

Continue: [Quoter](/docs/quoting) · [Fees](/docs/fees) · [Markets API](/docs/markets) · [Valuation](/docs/valuation).
