# REACTOR visual review (density pass)

Captured from the running app (Playwright, `CAPTURE=1`, review fixtures on `:43149`). Viewports **1440×900** and **390×844**. These are **not** homepage reuse.

| Surface | 1440 | 390 |
| --- | --- | --- |
| Home (dense table) | `home-1440.png` | `home-390.png` |
| Launch · Earn step | `launch-1440.png` | `launch-390.png` |
| Launch Instant confirm (FDV 25000) | `instant-1440.png` | `instant-390.png` |
| Launch Fair confirm | `fair-launch-1440.png` | `fair-launch-390.png` |
| Token detail (ZCAT + ticket) | `token-1440.png` | `token-390.png` |
| Trade board | `trade-1440.png` | `trade-390.png` |
| Rewards | `rewards-1440.png` | `rewards-390.png` |
| THE REACTOR | `reactor-1440.png` | `reactor-390.png` |
| CORE | `core-1440.png` | `core-390.png` |
| Fair live | `fair-1440.png` | `fair-390.png` |
| Wallet (disconnected + connected sample) | `wallet-1440.png` | `wallet-390.png` |

Review fixtures (`NEXT_PUBLIC_REVIEW_FIXTURES=1`) populate the board when the factory is empty. Banner says so. Live Anvil data replaces them when present.

## Review notes

- Home is a **table** (token / earns / mode / supply / rewards). Distinct from token detail (chart + buy/sell ticket).
- Instant confirm shows USDC FDV **$10k–$50k** and default **25000**.
- `/reactor` ranks #1–#4 in fixtures; copy states #11 gets zero and Instant FDV is not a rank.
- Mobile: wordmark text hidden; Trade/Rewards links hidden; table drops Mode/Supply/Rewards columns.
- Wallet page shows live disconnected state plus a labeled connected sample.
