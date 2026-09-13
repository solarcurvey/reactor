# REACTOR web

Production launchpad UI. Visual identity is **Industrial Forge** (Direction C, founder-locked). See [`docs/brand.md`](../../docs/brand.md).

```bash
pnpm --filter web dev --port 43147
pnpm --filter web build
pnpm --filter web test:qa
```

## Brand assets

Canonical vectors live in `public/brand/`. The app consumes:

- `src/components/logo.tsx` — vessel mark + wordmark
- `public/favicon.svg` / `public/favicon.ico`
- `public/apple-touch-icon.png`
- `public/icons/app-192.png` + `app-512.png` + `site.webmanifest`
- `public/og/default.png` and `og/token-fallback.png`

Regenerate rasters from SVG:

```bash
node scripts/generate-brand-assets.mjs
```

Do not restore Next / Vercel placeholder icons on user-facing surfaces. #55 stays open until independent audit. Frozen economics / Factory V1 are unchanged.
