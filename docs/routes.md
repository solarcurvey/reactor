# Routes

> Protocol **0.2.0**. Max 3 hops. Proven venues only.

`POST /quote` simulates **exact** RouteGraph edges. Kinds:

| Kind | Meaning |
| --- | --- |
| `OFFICIAL_REACTOR_V4` | Official hook, 0% LP, 3.5% quote-side |
| `EXTERNAL_V4_HOOKLESS` | Proven external v4 pool (fee/hooks from stored key) |
| `BONDING_CURVE` | InstantCurve buy/sell |

The planner does **not** recreate a generic 0.30% hookless pool. Multi-candidate search ≤ 3 hops; the ticket uses the best simulated candidate. Maintenance: sim fail → unavailable.
