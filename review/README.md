# REACTOR visual review

Captured from the running local app (Playwright, `CAPTURE=1`) against **current** UI on Anvil 5042002. Viewports **1440×900** and **390×844**.

| Surface | 1440 | 390 |
| --- | --- | --- |
| Home | `home-1440.png` | `home-390.png` |
| Instant launch (no FDV slider) | `launch-1440.png` | `launch-390.png` |
| Batch Fair launch | `fair-launch-1440.png` | `fair-launch-390.png` |
| CORE genesis | `core-1440.png` | `core-390.png` |
| THE REACTOR | `reactor-1440.png` | `reactor-390.png` |
| Bonding token | `token-bonding-1440.png` | `token-bonding-390.png` |
| Trade board | `trade-1440.png` | `trade-390.png` |
| Rewards | `rewards-1440.png` | `rewards-390.png` |
| Fair live | `fair-1440.png` | `fair-390.png` |
| Wallet | `wallet-1440.png` | `wallet-390.png` |
| Quote USDC / ZEC | `quote-usdc-*.png` / `quote-zec-*.png` |

```bash
pnpm --filter indexer seed-bonding   # writes BONDING_TOKEN
CAPTURE=1 BONDING_TOKEN=0x… pnpm --filter web test
```

Instant launch has **no creator FDV / supply / fee knobs**. CORE is genesis, not Instant. `/reactor` states ranks are not a trustless oracle.
