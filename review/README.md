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
| Token terminal (USDC nested) | `token-terminal-1440.png` | `token-terminal-390.png` |
| Internal ops | `ops-1440.png` | `ops-390.png` |

```bash
pnpm --filter indexer seed-review    # prints BONDING_TOKEN (Neon fixture)
CAPTURE=1 BONDING_TOKEN=0x1111111111111111111111111111111111110004 NEXT_PUBLIC_REVIEW_FIXTURES=1 pnpm --filter web test -- e2e/capture.spec.ts
```

Instant launch has **no creator FDV / supply / fee knobs**. CORE is genesis, not Instant. `/reactor` states ranks are not a trustless oracle.

CI visual / a11y / failure-injection gate (committed Playwright snapshots, not these review PNGs):

```bash
pnpm --filter web test:qa
pnpm --filter web test:update-screenshots
```

`?inject=` (indexer / rpc / quote family / pricing / upload / SSE / empty / invalid / wallet) and `/?qa=1` are review/QA-build only. CI screenshots also cover 1280 laptop and 360 Android against `next build`. See `/docs/qa`.
