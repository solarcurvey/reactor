/**
 * Canonical REACTOR brand tokens — Direction C, Industrial Forge.
 * Founder-locked 2026-09-13 (issue #55 / PR #78). Presentation only.
 * Frozen economics / Factory V1 / architecture are unchanged.
 */

export const BRAND_DIRECTION = "C" as const;
export const BRAND_NAME = "Industrial Forge";

export const BRAND = {
  slag: "#12110f",
  steel: "#2a2c2e",
  steelBright: "#3a3d41",
  vessel: "#8a8e92",
  heat: "#ff6b2b",
  heatHot: "#ff8a4a",
  ember: "#ffb086",
  paper: "#ece8e1",
  muted: "#9aa4ad",
  ink: "#ece8e1",
  ctaInk: "#12110f",
  up: "#3dcc8a",
  down: "#e85d4c",
  warn: "#e8b86d",
} as const;

export const BRAND_TYPE = {
  sans: "Geist Sans",
  mono: "Geist Mono",
  wordmarkTracking: "0.08em",
  stampTracking: "0.16em",
} as const;

export const BRAND_RADIUS = {
  card: "4px",
  chip: "2px",
  control: "4px",
} as const;

export const BRAND_COPY = {
  product: "REACTOR",
  flywheel: "THE REACTOR",
  core: "CORE",
  category: "Token launch on Arc",
  tagline: "Launch. Reflect. Burn.",
  title: "REACTOR — Token launch on Arc",
  description:
    "Launch markets that pay holders. Official REACTOR pools on Arc. Not an AI trading terminal.",
  ogTitle: "REACTOR",
  ogDescription: "Token launch markets on Arc. Launch. Reflect. Burn.",
} as const;

export const BRAND_VOICE = {
  names: ["REACTOR", "THE REACTOR", "CORE", "Standard", "Rewards", "Dev Buy", "Instant", "Fair"] as const,
  avoid: [
    "Arc Reactor",
    "Reactor Terminal",
    "AI",
    "agents",
    "perps",
    "super-app",
    "messaging layer",
    "trustless oracle",
    "audited",
  ] as const,
} as const;
