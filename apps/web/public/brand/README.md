# REACTOR brand assets — Industrial Forge

Founder-locked Direction **C** (issue #55). Canonical vectors live here. The production app uses the same mark via `apps/web/src/components/logo.tsx` and `/favicon.svg`.

| File | Use |
| --- | --- |
| `mark.svg` | Dark-background REACTOR vessel |
| `mark-light.svg` | Light-safe (docs print / GitHub) |
| `mark-core.svg` | CORE heat-load (same family, inner void) |
| `wordmark-dark.svg` / `wordmark-light.svg` | Lockup + “Token launch on Arc” |
| `safari-pinned.svg` | Monochrome pinned-tab |
| `../favicon.svg` | Favicon / compact mark |
| `../og/default.svg` + `.png` | Default Open Graph |
| `../og/token-fallback.svg` + `.png` | Token-page preview fallback |

Clear space = ¼ of mark diameter. Digital minimum 24px. Favicon may use the compact 32 viewBox. No remote/runtime logo URLs. No Marvel / Iron Man / “Arc Reactor” artwork.

Raster PNGs are generated from these SVGs (`scripts/generate-brand-assets.mjs`). Do not treat rasters as the source.
