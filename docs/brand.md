# Brand system

> **FOUNDER-LOCKED: Direction C — Industrial Forge.** Davis, 2026-09-13, PR #78.  
> Issue **#55 stays open** until production surfaces, launch assets, and [#36](https://github.com/solarcurvey/reactor/issues/36) visual/a11y baselines match this lock.  
> **Not audited. No mainnet.** Protocol economics, Factory V1, CORE, and THE REACTOR names are unchanged.

Presentation only. Do not change the 3.5% split, Instant bonding → ready → frozen → graduate, CORE genesis, Guardian / Keeper, or Factory V1 to “fit the paint.”

Specimen: [`apps/web/src/app/brand/page.tsx`](../apps/web/src/app/brand/page.tsx) (local `/brand`). Canonical mark: [`apps/web/public/brand/mark.svg`](../apps/web/public/brand/mark.svg).

---

## Locked direction

Industrial chrome. Slag ground, steel stamps, heat only on primary actions and the vessel ember.

| Slot | Value |
| --- | --- |
| Slag / void | `#12110F` |
| Steel | `#2A2C2E` |
| Heat | `#FF6B2B` |
| Paper | `#ECE8E1` |
| Cool steel | `#9AA4AD` |
| Up / down | `#3DCC8A` / `#E85D4C` (plus a mark — color is not the only signal) |
| Type | Geist Sans + Geist Mono. Heavier titles, tracking ≤ 0.12em |
| Radius | Card 4px · chip 2px · control 4px |
| Mark | Thick steel vessel, hexagonal ember, one heat notch |

A (Terminal Core) and B (Market Tape) were considered and **not** chosen. Archived concept SVGs stay under `apps/web/public/brand/concepts/` for history. Do not mix A cyan or B amber into production chrome.

Tokens: [`apps/web/src/styles/brand-tokens.css`](../apps/web/src/styles/brand-tokens.css). Tailwind aliases `rx-slag` / `rx-steel` / `rx-heat` / `rx-paper` / `rx-cool`.

---

## Marks and surfaces

| Asset | Path |
| --- | --- |
| Mark (dark) | [`apps/web/public/brand/mark.svg`](../apps/web/public/brand/mark.svg) |
| Mark (light) | [`apps/web/public/brand/mark-light.svg`](../apps/web/public/brand/mark-light.svg) |
| Wordmark dark | [`apps/web/public/brand/wordmark-dark.svg`](../apps/web/public/brand/wordmark-dark.svg) |
| Wordmark light | [`apps/web/public/brand/wordmark-light.svg`](../apps/web/public/brand/wordmark-light.svg) |
| Favicon | [`apps/web/public/favicon.svg`](../apps/web/public/favicon.svg) + `favicon.ico` |
| Apple touch | [`apps/web/public/apple-touch-icon.png`](../apps/web/public/apple-touch-icon.png) |
| PWA | `app-192.png` / `app-512.png` + [`site.webmanifest`](../apps/web/public/site.webmanifest) |
| OG default | [`apps/web/public/brand/og-default.png`](../apps/web/public/brand/og-default.png) |
| Token OG fallback | [`apps/web/public/brand/og-token-fallback.png`](../apps/web/public/brand/og-token-fallback.png) |

Clear space = ¼ mark diameter. Digital min 24px. Favicon may use the compact vessel. Compact header is mark-only plus accessible text `REACTOR`.

| Surface | Shared | Distinct |
| --- | --- | --- |
| REACTOR | Vessel + wordmark | Launchpad chrome |
| THE REACTOR | Same vessel | Stamped rank plates, title includes **THE** |
| CORE | Same vessel | Heat-load frame, never a Top-10 badge |
| Standard vs Rewards | Same family | `EARNS {QUOTE}` vs `BUY+BURN` badges |
| Quote ecosystems | Quote badge + first-party icon | Not a mini-brand per quote |

---

## Domain and copy

`reactor.markets` is available and fits the product. Collision: [reactor.trade](https://www.reactor.trade/) (AI terminal) and [reactor.network](https://reactor.network/) (messaging). First-use copy must say **token launch on Arc**.

| Field | Locked |
| --- | --- |
| `<title>` | `REACTOR — Token launch on Arc` |
| Description | `Launch markets that pay holders. Official REACTOR pools on Arc. Not an AI trading terminal.` |
| OG title | `REACTOR` |
| OG description | `Token launch markets on Arc. Launch. Reflect. Burn.` |

Do not use: AI, agents, perps, super-app, messaging layer, Reactor Terminal, Arc Reactor, Marvel / Iron Man, audited, trustless oracle, fake urgency.

Nav label for `/reactor` is **THE REACTOR**. Product name is **REACTOR**. Protocol token is **CORE**.

---

## Voice

Confident, technical, concise. `REACTOR`, `THE REACTOR`, `CORE`, `Standard`, `Rewards`, `Dev Buy`, `Instant`, `Fair`. `Launch. Reflect. Burn.` `Not audited · no mainnet`.

---

## Accessibility

- Body and muted text stay AA on slag (`#9AA4AD` on `#12110F`).
- Heat is for primary actions and the ember — not the only state signal (up/down needs a mark).
- Marks have accessible text. Compact header includes `sr-only` REACTOR.
- `prefers-reduced-motion` / `motion-safe:` skips CORE pulse and mark spin.
- Controls stay ≥ 36px tall at 390px and 200% zoom.

#36 owns visual + a11y regression of **this** lock. This PR does not skip or weaken that gate. Recapture desktop/mobile baselines against Industrial Forge after merge.

---

## #55 still open

Canonical vectors and tokens are in-repo and wired. Founder lock is C. Remaining #55 acceptance (independent audit of the implemented system, #36 baselines, release-candidate screenshots) is **not** claimed done here. Do not close #55 from this PR. Refs #36 #15 #18.
