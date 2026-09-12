# Routes

> Protocol **0.3.3**. Max 3 hops. Proven venues only. One eth_call per candidate.

`POST /quote` previews **exact** RouteGraph edges through `UserRouteQuoter`. Kinds are preserved on every hop:

| Kind | Meaning |
| --- | --- |
| `OFFICIAL_REACTOR_V4` | Official hook, 0% LP, 3.5% quote-side |
| `EXTERNAL_V4_HOOKLESS` | Proven external v4 pool (fee/hooks from stored key) |
| `BONDING_CURVE` | InstantCurve buy/sell |

The planner does **not** recreate a generic 0.30% hookless pool. Multi-candidate search ≤ 3 hops; the winner is `pickBest` (a fatter raw `amountOut` can lose). Hops, `amountOut`, hop kinds, hop `minOut`s, `feeLegs[]`, and the terminal official/bonding leg are taken from **one** candidate — never a max-`finalOut` preview stitched onto a differently scored path. Nested official USDC → ZEC → ZCAT → CAT is two `feeLegs[]` (compound **688 bps**). `UserRouteQuoter` returns `hopOuts`/`kinds` of length `plannedHops + 1` (terminal market leg). On SELL, `minQuoteOut` is the slipped terminal quoteOut and `minFinalOut` is the slipped final USDC. Maintenance uses a **separate** fee-exempt planner (`exemptOfficialLegs[]`). Sim fail → unavailable. Never maintenance `minOut` 0/1.

See [Atomic quoter](/docs/quoting).
