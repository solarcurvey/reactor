# Visual notes — Industrial Forge (2026-09-13)

Canonical brand is Direction C. Baselines must match slag / steel / heat + the vessel mark. #36 `web-qa` fails unexplained drift.

CI visual gate is Linux Chromium against the **production `next build`** at 1440 / 1280 / 390 / 360. `review/` captures remain 1440 + 390 (`CAPTURE=1`, `BONDING_TOKEN=0x1111…0004` Neon, `NEXT_PUBLIC_REVIEW_FIXTURES=1`). No review-fixture FDV slider.

| Surface | Notes |
| --- | --- |
| Home | Choose-what-your-token-earns. Fixture board when indexer empty. |
| Launch | Compact Instant form. No range / Starting FDV control. Protocol owns FDV. Visible `idle` / phase line from #44. |
| Bonding token | `/token/0x1111…0004` Neon bonding terminal. No FDV knobs. Trade ticket shows #44 phase + Quote/Confirm chrome. |
| CORE | Genesis copy. Never Top-10. Confirmed buy+burn toast is bottom-right, not this page. |
| THE REACTOR | Offchain ranks / not a trustless oracle. Confirmed `Top10Buy` toast is bottom-right. |
| Failures | `?inject=` matrix (quote codes, pricing, upload, SSE, empty, invalid, wallet) + `/?qa=1` inject bar. CI `web-qa` (`ci.yml` full/main) owns `toHaveScreenshot` baselines (1440 / 1280 / 390 / 360) and fails on unexpected console errors / hydration / page exceptions. |
