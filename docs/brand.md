# Brand system (direction proposal)

> **FOUNDER DIRECTION — NOT LOCKED.** Refs [#55](https://github.com/solarcurvey/reactor/issues/55).  
> This page is a proposal for Davis. It does **not** close the brand gate. Do not treat any mark, palette, typeface, or domain as the approved identity.  
> **Not audited. No mainnet.** Protocol economics, Factory V1, CORE, and THE REACTOR names are unchanged.

Issue #55 is brand/product work. This pass ships a founder-ready **direction**, cheap tokens, and concept marks. It does **not** implement the full design system, replace production chrome, or produce release-candidate assets.

Working default in the shipped UI is still graphite + cyan + the concentric mark (Direction A). That is convenience, not approval.

Specimen (local app): [`/brand`](/brand). Source marks: `/brand/concepts/*.svg`.

---

## FOUNDER APPROVAL REQUIRED

**Davis picks one visual system.** That is the only decision this proposal asks for.

| Option | Chrome tone | One-line |
| --- | --- | --- |
| **A — Terminal Core** | Terminal | Graphite void, cyan containment rings, operator console. Closest to what is already shipping. |
| **B — Market Tape** | Market | Olive-black board, amber ring-R, tape/columns, quote-first. Fits `reactor.markets`. |
| **C — Industrial Forge** | Industrial | Slag + steel + heat, forged vessel, stamped labels. Furthest from generic crypto neon. |

Reply on #55 or this PR with **A**, **B**, or **C** (or a written hybrid: e.g. “A mark + B chrome”). Until that reply, nothing here is locked.

Not in this decision: fee split, CORE / THE REACTOR names, Instant vs Fair, Guardian/Keeper, or any contract behavior.

---

## What this is / is not

| This is | This is not |
| --- | --- |
| Three coherent systems (color, type, mark, chrome) | A final logo lockup |
| Domain + name-collision guidance | A claim that we registered `reactor.markets` |
| Launch-asset checklist for after approval | Production favicon / OG / app icons |
| Voice + capitalization for product UI | Marketing site copy |
| Cheap CSS tokens + concept SVGs | A redesign of frozen V1 economics |

No Marvel / Iron Man / Stark / “Arc Reactor” artwork. Study public launchpad **hierarchy** only. Interaction patterns may reference mature products; identity must be REACTOR’s own.

---

## Domain and name collision

`reactor.markets` is **available** and fits the product: we launch **markets** that pay holders in a chosen quote. Recommend it as the public host **after** Davis confirms (not part of the A/B/C visual vote).

### Collision set (crypto “Reactor”)

Other products already use the word. UI copy has to say what we are on first use — the mark alone will not.

| Other product | Surface | What they are | We are not that |
| --- | --- | --- | --- |
| [reactor.trade](https://www.reactor.trade/) | `.trade` | AI trading terminal / agents / perps / multi-chain super-app, `$REACT` | Not an AI terminal, not perps, not agents |
| [reactor.network](https://reactor.network/) | `.network` | Cross-chain / Web2↔Web3 messaging (ICP “Reactor Core”, gateways) | Not a connectivity layer; our CORE is the protocol token |
| Older RCT / veRCT DeFi writeups | various | ve(3,3)-style DEX / bribes | Different token (`CORE`), different machine |

`.markets` vs `.trade` vs `.network` is useful, but **copy** is the real differentiator.

### UI copy that differentiates (use these)

First-use / title / OG / footer, always pair the name with the category:

- **REACTOR — Token launch on Arc**
- **Launch markets that pay holders.** Official pools on Arc.
- Subline: `Built on Arc` (already shipping)

Do **not** use in product UI or social previews:

- “AI”, “agents”, “perps”, “super-app”, “messaging layer”, “Reactor Terminal”
- “Arc Reactor”, Marvel / Iron Man language
- “audited”, “trustless oracle”, fake urgency / casino spam

`THE REACTOR` is the Top-10 flywheel surface (`/reactor`), not a trading terminal. Say **THE REACTOR** (ranks) vs **REACTOR** (the launchpad).

Suggested metadata after a lock (not applied in this PR):

| Field | Proposed |
| --- | --- |
| `<title>` | `REACTOR — Token launch on Arc` |
| Description | `Launch markets that pay holders. Official REACTOR pools on Arc. Not an AI trading terminal.` |
| OG title | `REACTOR` |
| OG description | `Token launch markets on Arc. Launch. Reflect. Burn.` |

---

## Three directions

Each system is internally consistent. Do not mix marks and palettes until Davis asks for a hybrid.

### A — Terminal Core

Chrome: **terminal**. Evolution of the current app.

| Slot | Spec |
| --- | --- |
| Void | `#0B0D10` |
| Graphite | `#121418` |
| Core cyan | `#7EE8FF` |
| Ink | `#F4F7FB` |
| Muted | `#A1A1AA` (zinc-400, AA on void) |
| Type | Geist Sans + Geist Mono (already loaded) |
| Mark | Three concentric containment rings + luminous core. [SVG](/brand/concepts/a-terminal-core.svg) |
| Chrome | Dark glass cards, rounded-full chips, soft cyan radial wash, glow only on the primary CTA |
| Mood | Operator console. Precise, calm. Not neon-purple, not casino. |

Signature surfaces: REACTOR uses the rings; THE REACTOR keeps the same mark on a denser mono rank table; CORE uses a larger spinning mark (existing `ReactorCore`).

**Cost:** cheapest. Already in `logo.tsx` / `globals.css`. Risk: closer to “generic dark + cyan crypto” if the rings are not held tight.

[Mood board](/brand/boards/a-terminal-core.png) — raster type on the board is **placeholder**, not copy.

### B — Market Tape

Chrome: **market**. Built around `reactor.markets` and “choose what your token earns.”

| Slot | Spec |
| --- | --- |
| Board | `#0A0C0B` |
| Paper | `#141816` |
| Tape amber | `#E8B86D` |
| Up | `#3DCC8A` |
| Down | `#E85D4C` |
| Type | IBM Plex Sans + IBM Plex Mono (not loaded — proposal only) |
| Mark | Geometric ring with an R-cut (amber stroke, no glow). [SVG](/brand/concepts/b-market-tape.svg) |
| Chrome | Dense columns, ~8px radius, amber hairlines, no glow CTAs, 24h as tape (green/red **plus** a triangle — color is not the only signal) |
| Mood | Quote-first board. Signal over noise. |

Signature surfaces: REACTOR is the ring-R; THE REACTOR is a live tape (`#1`–`#10`); CORE is an amber fuel index, not a spinning orb.

**Cost:** medium. New type + chrome density. Risk: reads as a CEX tape if “token launch on Arc” is not in the header.

[Mood board](/brand/boards/b-market-tape.png) — raster type is **placeholder**, not copy.

### C — Industrial Forge

Chrome: **industrial**. Furthest from Pump / Raydium / Uniswap template aesthetics.

| Slot | Spec |
| --- | --- |
| Slag | `#12110F` |
| Steel | `#2A2C2E` |
| Heat | `#FF6B2B` |
| Paper | `#ECE8E1` |
| Cool steel | `#9AA4AD` |
| Type | Geist Sans, heavier weights, less tracking (or Satoshi-class grotesque if licensed later) |
| Mark | Thick steel vessel, hexagonal ember, one heat notch. [SVG](/brand/concepts/c-industrial-forge.svg) |
| Chrome | 1px steel borders, 0–4px radius, stamped uppercase labels, heat on primary actions only |
| Mood | Containment vessel. Heavy, honest. |

Signature surfaces: REACTOR is the vessel; THE REACTOR is stamped rank plates; CORE is heat-load, not cyan.

**Cost:** highest visual delta vs today. Risk: “heat” can read as a different product if we keep cyan anywhere.

[Mood board](/brand/boards/c-industrial-forge.png) — raster type is **placeholder**, not copy.

---

## Mark, wordmark, and surfaces

Concept SVGs are **not** production artwork. No light-background lockup is drawn yet (the app is dark-only). After a pick:

- Dark and light-safe variants if any light surface exists (docs print, GitHub social).
- Clear space = ¼ of mark diameter. Digital min 24px; favicon may drop to two rings + core (A) or a solid monogram (B/C).
- Wordmark is `REACTOR` in the chosen grotesque, tracked. Compact header may be mark-only with accessible text `REACTOR`.
- Vector source in-repo. No raster-only originals. No remote/runtime logo URLs.

| Surface | Shared | Distinct |
| --- | --- | --- |
| REACTOR | Chosen mark + wordmark | Launchpad chrome |
| THE REACTOR | Same family, not a second logo | Rank/tape density, “THE” in the title |
| CORE | Same family | Fuel / vest treatment — never a Top-10 badge |
| Standard vs Rewards | Same family | Badge copy (`EARNS {QUOTE}` vs `BUY+BURN`), not a second brand |
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

Nav today says `Reactor` for `/reactor` — after a lock, that label should become `THE REACTOR`. Not changed in this PR.

---

## Launch asset checklist

Produce **after** the A/B/C pick. None of these are release-ready in this PR. No Next / Vercel / `file.svg` placeholders in a release candidate.

| Asset | Spec | Status now |
| --- | --- | --- |
| `favicon.svg` | Mark, 32 viewBox, currentColor or void+core | Missing (Next default) |
| `favicon.ico` | 16 + 32 | Missing |
| Apple touch | 180×180 PNG, no alpha surprises | Missing |
| App / PWA | 192 + 512 PNG + `manifest` | Missing |
| Wordmark SVG | Dark + light | Dark concept only (`/brand/wordmark-dark.svg`) |
| Compact mark | Same as favicon family | Concept SVGs only |
| Default OG | 1200×630, title + differentiator line | Missing |
| Token OG fallback | 1200×630 when a token has no preview | Missing |
| README / GitHub social | Same family | Missing |
| Safari pinned | Mono SVG | Missing |

Metadata treatment: see the title/description table above. Token pages fall back to the default OG until dynamic previews exist.

---

## Implementation stubs (this PR)

Cheap only. **No** protocol/economics edit. **No** production chrome redesign.

| Stub | Path | Notes |
| --- | --- | --- |
| Direction A tokens | `apps/web/src/styles/brand-tokens.css` | Wired to current colors. B/C maps are documented, unused. |
| Concept marks | `apps/web/public/brand/concepts/*.svg` | Original vectors. Not swapped into `logo.tsx`. |
| Wordmark concept | `apps/web/public/brand/wordmark-dark.svg` | Direction A lockup. |
| Mood boards | `apps/web/public/brand/boards/*.png` | Chrome tone only. Garbled raster type is not copy. |
| Specimen | `apps/web/src/app/brand/page.tsx` | Not in primary nav. |

`logo.tsx` and product pages stay on Direction A until Davis picks.

---

## After approval (not this PR)

1. Lock tokens to the chosen system; delete unused B/C maps or keep them as history.
2. Replace `ReactorMark` / wordmark with canonical SVGs.
3. Cut the launch-asset list; remove `next.svg` / `vercel.svg` / `file.svg` from any user-facing surface.
4. Apply to Discover, terminal, Launch, Rewards, THE REACTOR, CORE, quote pages, wallet/dialogs, docs (#14), empty/error states.
5. #36 visual + a11y baselines cover the approved state.
6. #40 keeps UX/layout; this issue owns the paint on that layout.
7. #15 / #18 stay open until the #55 acceptance list is actually done.

---

## Accessibility (constraints for the later lock)

- Contrast: body and muted text stay AA on the void (today’s zinc-400 lift stands).
- Critical state cannot be color-only (tape up/down needs a mark).
- Marks need accessible text (`REACTOR`).
- `prefers-reduced-motion` already skips toast enter / CORE spin should honor it when the lock lands.
- Type remains usable at 390px and 200% zoom.

---

## Protocol

Unchanged. 3.5% quote charge (2% / 1% / 0.5%), Instant bonding → ready → frozen → graduate, CORE genesis, Guardian / Keeper, Factory V1. Different split = V2 factory, not a palette tweak.
