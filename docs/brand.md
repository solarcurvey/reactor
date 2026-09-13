# Brand system — Industrial Forge

> **Direction C locked.** Founder (Davis) approved Industrial Forge on 2026-09-13 ([#55](https://github.com/solarcurvey/reactor/issues/55), [PR #78](https://github.com/solarcurvey/reactor/pull/78)).  
> This is the canonical visual identity for product UI, docs, and launch assets.  
> **#55 stays open** until independent audit of the implemented surfaces.  
> **Not audited. No mainnet.** Protocol economics, Factory V1, CORE, and THE REACTOR names are unchanged.

Issue #55 is brand/product work. It does not redesign frozen V1 economics or architecture.

Specimen (not in primary nav): local app route `/brand` (`apps/web/src/app/brand/page.tsx`). Vectors: [`apps/web/public/brand/README.md`](../apps/web/public/brand/README.md). Tokens: [`apps/web/src/lib/brand.ts`](../apps/web/src/lib/brand.ts) + [`brand-tokens.css`](../apps/web/src/styles/brand-tokens.css).

---

## What is locked

| Slot | Spec |
| --- | --- |
| Direction | **C — Industrial Forge** |
| Slag | `#12110F` |
| Steel | `#2A2C2E` |
| Heat | `#FF6B2B` |
| Paper | `#ECE8E1` |
| Cool steel (muted) | `#9AA4AD` |
| Type | Geist Sans + Geist Mono, heavier weights, tight tracking |
| Mark | Thick steel vessel, hexagonal ember, one heat notch |
| Chrome | 1px steel borders, 0–4px radius, stamped uppercase labels |
| Accent rule | Heat on primary actions and kickers only. No cyan. No glow CTAs. |

Rejected (do not mix back in): A Terminal Core (graphite + cyan rings), B Market Tape (amber ring-R). Keep them out of production chrome.

No Marvel / Iron Man / Stark / “Arc Reactor” artwork.

---

## Domain and name collision

`reactor.markets` fits the product (we launch **markets**). It is a recommended public host, not a claim that the name is registered.

| Other product | What they are | We are not that |
| --- | --- | --- |
| [reactor.trade](https://www.reactor.trade/) | AI trading terminal / agents / perps | Not an AI terminal, not perps |
| [reactor.network](https://reactor.network/) | Cross-chain messaging | Not a connectivity layer; CORE is the protocol token |

UI copy must say **token launch on Arc** on first use.

| Field | Value |
| --- | --- |
| `<title>` | `REACTOR — Token launch on Arc` |
| Description | `Launch markets that pay holders. Official REACTOR pools on Arc. Not an AI trading terminal.` |
| OG title | `REACTOR` |
| OG description | `Token launch markets on Arc. Launch. Reflect. Burn.` |

Do **not** use in product UI or social previews: “AI”, “agents”, “perps”, “super-app”, “messaging layer”, “Reactor Terminal”, “Arc Reactor”, “audited”, “trustless oracle”, fake urgency.

`THE REACTOR` is the Top-10 flywheel (`/reactor`). `REACTOR` is the launchpad.

---

## Mark, wordmark, and surfaces

- Dark: [`mark.svg`](../apps/web/public/brand/mark.svg). Light-safe: [`mark-light.svg`](../apps/web/public/brand/mark-light.svg).
- CORE heat-load: [`mark-core.svg`](../apps/web/public/brand/mark-core.svg) (inner void hex).
- Wordmark: [`wordmark-dark.svg`](../apps/web/public/brand/wordmark-dark.svg) / [`wordmark-light.svg`](../apps/web/public/brand/wordmark-light.svg).
- Clear space = ¼ of mark diameter. Digital min 24px. Favicon uses the compact 32 viewBox.
- Header may be mark-only below `sm` with accessible text `REACTOR`.
- Vector source in-repo. No raster-only originals. No remote/runtime logo URLs.

| Surface | Shared | Distinct |
| --- | --- | --- |
| REACTOR | Vessel + wordmark | Launchpad board |
| THE REACTOR | Same family | Stamped rank plates, heat numerals, “THE” in the title |
| CORE | Same family | Heat-load inner void — never a Top-10 badge |
| Standard vs Rewards | Same family | Badge copy (`EARNS {QUOTE}` vs `BUY+BURN`) |
| Quote ecosystems | Quote badge + first-party icon | Not a mini-brand per quote |

---

## Voice (product UI only)

Confident, technical, concise.

| Do | Do not |
| --- | --- |
| `REACTOR`, `THE REACTOR`, `CORE` | `Reactor` / `The Reactor` / `Core` in UI chrome |
| `Standard`, `Rewards`, `Dev Buy`, `Instant`, `Fair` | `CCA`, creator fee, “points” |
| `Launch. Reflect. Burn.` | Fake countdown urgency |
| `Not audited · no mainnet` | Safety or return promises |
| `Top-10 is an offchain API` | `trustless oracle` |

Nav label for `/reactor` is **THE REACTOR**.

---

## Launch assets

| Asset | Path |
| --- | --- |
| Favicon SVG | `/favicon.svg` |
| Favicon ICO | `/favicon.ico` |
| Apple touch | `/apple-touch-icon.png` (180×180) |
| App / PWA | `/icons/app-192.png`, `/icons/app-512.png`, `/site.webmanifest` |
| Default OG | `/og/default.png` (1200×630) |
| Token OG fallback | `/og/token-fallback.png` |
| Safari pinned | `/brand/safari-pinned.svg` |

No Next / Vercel / `file.svg` placeholders on user-facing surfaces. Token pages use the default OG until dynamic previews exist.

Regenerate rasters from SVG sources:

```bash
node scripts/generate-brand-assets.mjs
```

---

## Accessibility

- Contrast: paper and muted steel stay WCAG AA on slag / steel. Pinned in `e2e/contrast.ts` (full `web-qa` plus `pnpm test:lib`).
- Critical state cannot be color-only (up/down uses green/red **and** the existing numeric/tape copy).
- Marks have accessible text (`REACTOR` / `CORE`).
- `prefers-reduced-motion` skips toast enter, CORE pulse/spin, and loading pulse.
- Type remains usable at 390px, 360px, and 200% zoom (640 CSS px). #36 owns the gate — do not weaken `web-qa`.

---

## Protocol

Unchanged. 3.5% quote charge (2% / 1% / 0.5%), Instant bonding → ready → frozen → graduate, CORE genesis, Guardian / Keeper, Factory V1. Different split = V2 factory, not a palette tweak.
