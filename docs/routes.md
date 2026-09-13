# Routes

> Protocol **{{protocolVersion}}**. Max 3 hops. Proven venues only. One eth_call per candidate.

`POST /quote` previews **exact** RouteGraph edges through `UserRouteQuoter`. Kinds are preserved on every hop:

| Kind | Meaning | User 3.5% |
| --- | --- | --- |
| `OFFICIAL_REACTOR_V4` | Official hook, 0% LP, 3.5% quote-side | Yes |
| `EXTERNAL_V4_HOOKLESS` | Proven external v4 pool (fee/hooks from stored key) | No |
| `BONDING_CURVE` | InstantCurve buy/sell | Yes, on executed quote |

The planner does **not** recreate a generic 0.30% hookless pool. Multi-candidate search ≤ 3 hops, no cycles, no duplicate assets; the winner is `pickBest` (a fatter raw `amountOut` can lose). Hops, `amountOut`, hop kinds, hop `minOut`s, `feeLegs[]`, and the terminal official/bonding leg are taken from **one** candidate — never a max-`finalOut` preview stitched onto a differently scored path.

## User vs protocol planner

| Path | Planner | Adapter | Fee disclosure |
| --- | --- | --- | --- |
| User `POST /quote` | `planCandidates` + `UserRouteQuoter` | `UniswapV4Adapter` / curve | `feeLegs[]` on the `pickBest` winner |
| Keeper / vaults | `planFeeExemptRoute` | `ProtocolV4Adapter` | `exemptOfficialLegs[]` (`protocolFeeBps = 0`) |

Do not reuse the user quoter for vault jobs. `UserRouteExecutor` is **not** a protocol vault. Callers that are protocol vaults revert. It cannot spend vault pots.

## Nested official compound

Nested official USDC → ZEC → ZCAT → CAT is two `feeLegs[]` (compound **688 bps** / **6.88%**). `UserRouteQuoter` returns `hopOuts`/`kinds` of length `plannedHops + 1` (terminal market leg). On SELL, `minQuoteOut` is the slipped terminal quoteOut and `minFinalOut` is the slipped final USDC.

Maintenance uses the fee-exempt planner. Sim fail → unavailable. Never maintenance `minOut` 0/1.

## Guardrails (onchain)

- `tokenIn` / amount from the caller (user wallet or vault bucket)
- Adapter must be Guardian-approved
- v4 hops: hookless or official REACTOR hook only — no `setHook`, no arbitrary hooks
- Real balance deltas per hop; next hop uses actual out (lying adapters fail)
- Intermediate `hop.minOut == 0` reverts
- ≤ 3 hops, no cycles, no duplicate assets
- Reentrancy lock

See [Atomic quoter](/docs/quoting), [Nested fees](/docs/fees), [Builders](/docs/builders).
