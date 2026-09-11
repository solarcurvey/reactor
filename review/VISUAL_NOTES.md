# Visual notes — 2026-09-11 density pass

Reviewed the Playwright PNGs after capture. Fixes applied, then recaptured.

| Issue | Fix |
| --- | --- |
| Token-detail used to be a homepage screenshot | Dedicated `/token/0x1111…0001` with chart + ticket |
| Empty token chart under fixtures | Swap-series falls back to fixture prints when indexer is empty |
| Fair live showed epoch-0 / 1970 dates | Review path uses `FIXTURE_FAIR` when chain row is zero |
| Instant FDV default 80000 (out of USDC range) | Default **25000**, range hint on confirm |
| Mobile nav clipped wallet / mid-links | Icon-only mark on xs; hide Trade/Rewards; wallet `shrink-0` |
| Mobile home table overflow | Drop Mode/Supply/Rewards columns under `sm`/`md` |
| VOLT fixture mcap $210k (below floor) | Set to $290k |

Residual: fixture ranks are labeled review, not live TWAP. Chart is a 3-print stub, not a professional terminal.
