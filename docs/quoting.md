# Atomic route quoter

User quotes are a **single `eth_call`** over the whole route (`UserRouteQuoter.previewBuy` / `previewSell`) with **ERC-20 state overrides** that credit the quoter (not the user wallet) on candidate `balanceOf` slots. Nested hops do **not** need intermediate wallet balances. The user can hold only USDC.

## What is simulated

| Venue | Kind (preserved end-to-end) | Who pays 3.5% |
| --- | --- | --- |
| Official REACTOR pool | `OFFICIAL_REACTOR_V4` | Yes — hook quote-side charge |
| Hookless external v4 | `EXTERNAL_V4_HOOKLESS` | No |
| Instant bonding curve | `BONDING_CURVE` | Yes, on executed quote |

Edge `kind` is kept through plan → preview → `POST /quote` hops. Nested official legs each appear in `feeLegs[]` (`reactorFeeCount`, `totalProtocolFeeBps`).

## Multi-candidate

The planner emits ≤8 candidates, ≤3 hops, no cycles. Each candidate is previewed with **one** `UserRouteQuoter` call. The winner is the real `amountOut`, not a fake hop-count score.

If `UserRouteQuoter` is **not deployed**, the indexer falls back to one `UserRouteExecutor` `simulateContract`. That fallback is documented only for an undeployed quoter and **may still need wallet balances**. Deploy the quoter for override-based nested quotes.

## Protocol / maintenance path (separate)

`buildMaintenanceQuote` uses `planFeeExemptRoute` + ProtocolV4Adapter. It never shares the user quoter. Successful maintenance quotes refuse `minOut` 0 or 1 (`applySlippage` / `applyMinOuts` / `RouteExec`).

A failed preview is **unavailable** — the API returns `ok: false`, not a dust floor.
