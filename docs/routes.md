# Routes

> Protocol **0.3.2**. Max 3 hops. Proven venues only. One eth_call per candidate.

`POST /quote` previews **exact** RouteGraph edges through `UserRouteQuoter`. Kinds are preserved on every hop:

| Kind | Meaning |
| --- | --- |
| `OFFICIAL_REACTOR_V4` | Official hook, 0% LP, 3.5% quote-side |
| `EXTERNAL_V4_HOOKLESS` | Proven external v4 pool (fee/hooks from stored key) |
| `BONDING_CURVE` | InstantCurve buy/sell |

The planner does **not** recreate a generic 0.30% hookless pool. Multi-candidate search ≤ 3 hops; the ticket uses the best **real `amountOut`**. Hops, `amountOut`, hop kinds, hop `minOut`s, and the terminal official/bonding leg are taken from **one** candidate — never a max-`finalOut` preview stitched onto a differently scored path. `UserRouteQuoter` returns `hopOuts`/`kinds` of length `plannedHops + 1` (terminal market leg). Maintenance uses a **separate** fee-exempt planner. Sim fail → unavailable. Never maintenance `minOut` 0/1.

See [Atomic quoter](/docs/quoting).
