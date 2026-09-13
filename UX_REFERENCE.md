# UX_REFERENCE

Structure-only notes from public Stonk-class launchpads (2026-09-11). **No copy, assets, or code were taken.** REACTOR brand stays graphite + cyan core + concentric mark.

## Layout density

- Header: mark, Discover, Launch/IGNITE, Rewards, CORE, compact wallet.
- Home is a **board**, not a landing page: live filters, dense token cards, one featured rail.
- Cards: icon, ticker, quote badge, FDV/mcap (`current_supply` × mark — tracks remaining onchain `totalSupply` after `burn()`, not the initial 1B mint, not a live ≡), 24h, volume, spark. One primary action.
- Token page is **trading-first**: chart + ticket above fold; social/meta below. Social links render only after the URL allowlist (`noopener noreferrer nofollow`). Images use `SafeTokenImage` (first-party media only).
- Instant form is compact: image, name, ticker, description, quote, EARNS X vs BUY+BURN, optional Dev Buy. No curve knobs.

## Interaction

- Filters are chips, not a settings panel.
- Quote is a first-class identity (`EARNS ZEC`, not “paired with”).
- Sell ticket shows **two** mins: first-leg quote floor and final USDC floor (different units).
- Ranked rail shows #1–#10 and distance-to-#11.
- Activity is a feed with explorer links, not RPC-polled tables.
- Board / search / token page / quote picker read the indexer (`/markets`, `/page/token`, `/quote-assets`). Search is SQL `q` + `stage`, not a client filter of the full board. Token page is one aggregated hop. Live swap tickets stay `POST /quote` (30s, fail-closed) — not a cached mark. Expensive catalog/CORE/wallet reads do not refetch on window focus. SSE trade prints patch cached rows; they do not refetch the board.
- Confirmed CORE and Top-10 buy+burn land as **bottom-right** toasts after indexer SSE commit (not mempool, not epoch submit, not Standard SelfBurn). Dedupe is `(chainId, tx, logIndex, eventKind)` and survives dismiss. Auto-dismiss pauses on hover/focus. Safe-area insets. `prefers-reduced-motion` skips the enter animation. Explorer tx link.

## Failures (visible, not empty)

Indexer / RPC / `POST /quote` outages use a shared `role="alert"` banner + Retry. Copy is honest: onchain still settles; a failed quote is not a 0/1 `minOut` ticket. QA-build `?inject=` covers 429/413/5xx, stale/expired/no-route quotes, pricing fail-closed, upload, SSE (no duplicate toasts), empty markets, invalid token/ticker, wallet reject/revert. `/?qa=1` opens the inject bar. Production ignores inject.

## Accessibility

Skip-to-main, labelled search/trade/launch fields, `aria-pressed` on chips and buy/sell, `aria-current` on nav, accessible home mark on 390 (logo is otherwise SVG-only). Dialogs (Account, confirm) trap focus and restore it. Live toasts use `role="status"|"alert"` + `aria-live`. `prefers-reduced-motion` kills pulse. Keyboard reaches filters, launch quote buttons, and the ticket. CI axe is `wcag2a/21a/2aa` **including color-contrast** (canvas / CORE mark / live ticks excluded as unmeasurable). Brand tokens are also asserted deterministically; muted copy uses `text-zinc-400` (stock zinc-500/600 fail AA on `#0b0d10`). Plus 200% zoom / 320 CSS px reflow. The QA fixture also fails the production-build gate on unexpected console errors, hydration warnings, and uncaught page exceptions.

## Mobile 390 / 360 Android

- Single column. Ticket stacks under chart. Filters wrap. Cards stay tappable.
- Trade ticket shows backend `feeLegs[]` (each official 3.5% on the scored winner) **per hop quote + decimals**, plus compound `aggregateProtocolImpactBps`. Do not sum ZEC and ZCAT raw fee amounts. Routed SELL uses ticket `minQuoteOut` (quote units), not tokenIn.

## REACTOR mapping

| Stonk-class surface | REACTOR |
| --- | --- |
| Board + filters | Home + IGNITE + THE REACTOR |
| Pair badge | EARNS {QUOTE} |
| Bonding / curve | Instant bonding % + quote raised / to grad, then seamless v4 |
| Platform token | CORE dashboard + 0.5% buy/burn |
| Points / flywheel | 1% Top-10 flywheel |
