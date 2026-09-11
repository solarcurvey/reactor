# For traders

## Board

The homepage is `GET /markets` — search, stage, quote, sort. No per-token RPC on the board. Live tape via SSE `/stream`.

## Ticket

`POST /quote` plans **proven** venues only (≤3 hops). Official 3.5% legs are listed **separately**. The UI does not invent a 0.30% pool that is not in the route graph.

You submit exact-in with a **nonzero minOut**. Incomplete fills revert.

## Bonding vs v4

Before graduation you trade on the Instant curve. After `graduate()`, the official hooked 0% LP pool is the market. OHLCV is the same `price_quote_x18` unit on both sides so the chart continues.

## Rewards

Rewards Instant: 2% of quote notional accrues to holders, O(1), no staking, survives transfers. Standard: that 2% later market-buys and burns the token. If Rewards `eligibleSupply == 0`, the 2% goes to SelfBurn — not the first holder.

## Nested quotes

A token can earn ZEC, or a graduated ZCAT. USD marks multiply the official path (CAT→ZCAT→ZEC→USD). Parent-only USD is rejected. See [nested fees](/docs/fees).
