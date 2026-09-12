# For traders

> Protocol **0.2.0** · Official charge **3.5%** (2% holders / 1% / 0.5% CORE)

## Board

The homepage is `GET /markets` — SQL search, stage, quote, sort, limit, offset. No per-token RPC on the board. Live tape via SSE `/stream`. Dedicated search: `/search`.

## Ticket

`POST /quote` plans **proven** RouteGraph venues only (≤3 hops). Kinds: `OFFICIAL_REACTOR_V4`, `EXTERNAL_V4_HOOKLESS`, `BONDING_CURVE`. Official 3.5% legs are listed **separately**. The API does not invent a 0.30% pool that is not in the graph. If simulation fails, the quote is **unavailable** — never `minOut` 0 or 1.

You submit exact-in with a **nonzero minOut**. Incomplete fills revert.

Terminal: Lightweight Charts OHLCV + tape on `/token/[address]`.

## Bonding vs v4

Before graduation you trade on the Instant curve. After `graduate()`, the official hooked 0% LP pool is the market. OHLCV is the same `price_quote_x18` unit on both sides so the chart continues.

## Rewards

Rewards Instant: 2% of quote notional accrues to holders, O(1), no staking, survives transfers. Standard: that 2% later market-buys and burns the token. If Rewards `eligibleSupply == 0`, the 2% goes to SelfBurn — not the first holder.

## Nested quotes

A token can earn ZEC, or a graduated ZCAT. USD marks multiply the official path (CAT→ZCAT→ZEC→USD). Parent-only USD is rejected. See [nested fees](/docs/fees).
