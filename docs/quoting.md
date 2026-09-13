# Atomic route quoter

User quotes are a **single `eth_call`** over the whole route (`UserRouteQuoter.previewBuy` / `previewSell`). The quoter **executes hops in-place** (no nested revert that would undo intermediate balances) and then reverts `PreviewRoute`. The indexer also sends ERC-20 **state overrides** that credit the quoter — not the user wallet — on candidate `balanceOf` slots. Nested hops do **not** need intermediate wallet balances. The user can hold only USDC.

## What is simulated

| Venue | Kind (preserved end-to-end) | Who pays 3.5% |
| --- | --- | --- |
| Official REACTOR pool | `OFFICIAL_REACTOR_V4` | Yes — hook quote-side charge |
| Hookless external v4 | `EXTERNAL_V4_HOOKLESS` | No |
| Instant bonding curve | `BONDING_CURVE` | Yes, on executed quote |

Edge `kind` is kept through RouteGraph → planner (`Hop.kind`) → `UserRouteQuoter` preview (pool-key hooks vs official hook) → `POST /quote` hops. `feeLegs[]` are built from the **scored winner** (`selectAtomicQuotedRoute` / `pickBest`) plus that winner’s terminal official/bonding market — never an independently tracked max-`amountOut` preview. Nested official legs each appear in `feeLegs[]` (`reactorFeeCount`, `totalProtocolFeeBps` = sum, `aggregateProtocolImpactBps` = compound). Two 3.5% official hops → 700 bps listed, **688 bps / 6.88%** compound before slippage. Clients format each charged leg in that hop’s quote decimals; they must not add raw ZEC and ZCAT fee amounts.

## Multi-candidate

The planner emits ≤8 candidates, ≤3 hops, no cycles. Each candidate is previewed with **one** `UserRouteQuoter` call. The winner is the real `amountOut`, not a fake hop-count score.

The ticket is **atomic**: `path`, routing-hop `kind`s, `amountOut`, hop `amountOut`s, hop `minOut`s, and the terminal official/bonding result all come from the **same** selected candidate. The indexer never pairs `bestPreview` (max `finalOut`) with a differently scored route.

`PreviewRoute` allocates `hopOuts` / `kinds` as **`plannedHops.length + 1`**. The extra element is the terminal official/bonding market leg (BUY appends it; SELL prepends it). Routing-hop outs/kinds have length `plannedHops`. `amountOut` is the final token (BUY) or USDC (SELL). Hop `minOut`s are `applySlippage` on that candidate's **routing** hop outs. The terminal floor is `applySlippage` on the extra element (SELL `minQuoteOut` uses that quote-out).

Indexer decode is the same `decodePreviewRoute` used by `POST /quote`. Foundry `UserRoute.t.sol` decodes live `previewBuy` / `previewSell` reverts and asserts `hopOuts.length == hops.length + 1`.

If `UserRouteQuoter` is **not deployed**, the indexer falls back to one `UserRouteExecutor` `simulateContract`. That fallback is documented only for an undeployed quoter and **may still need wallet balances**. Deploy the quoter for override-based nested quotes.

## Protocol / maintenance path (separate)

`buildMaintenanceQuote` uses `planFeeExemptRoute` + ProtocolV4Adapter. It never shares the user quoter. Successful maintenance quotes refuse `minOut` 0 or 1 (`applySlippage` / `applyMinOuts` / `RouteExec`).

## SELL floors

SELL tickets apply slippage independently on the **same** selected `PreviewedRoute`:

1. `splitPreviewRoute.terminalOut` (first-leg quoteOut) → `minQuoteOut`
2. `amountOut` (final USDC) → `minOut` / executor `minFinalOut`
3. each routing hop out → that hop’s `minOut`

`minQuoteOut` is quote units. It is never launch-token `amountIn`. A missing first-leg (`hopOuts` empty) or malformed `plannedHops+1` preview fails the ticket (`ok: false`, no `tx`). Routed SELLs do not rebuild `hopOuts` from sequential hop sims — they use the selected `#21` `PreviewedRoute` only.

Catalog batching (`/markets`, `/page/token`, `/quote-assets`, Multicall3 probe) does **not** cache or relax this ticket. TTL stays **30 seconds**. Indexed marks are display-only.

A failed preview is **unavailable** — the API returns `ok: false`, not a dust floor.
