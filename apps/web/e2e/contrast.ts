/** WCAG 2 relative luminance + contrast. Used by the QA gate and unit tests. */

export function srgbChannelToLinear(channel: number): number {
  const x = channel / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

export function parseCssColor(input: string): { r: number; g: number; b: number } | null {
  const hex = input.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short) {
    const n = short[1];
    return {
      r: parseInt(n[0] + n[0], 16),
      g: parseInt(n[1] + n[1], 16),
      b: parseInt(n[2] + n[2], 16),
    };
  }
  const long = /^#([0-9a-f]{6})$/i.exec(hex);
  if (long) {
    const n = long[1];
    return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16) };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(hex);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return null;
}

export function contrastRatio(fg: string, bg: string): number {
  const a = parseCssColor(fg);
  const b = parseCssColor(bg);
  if (!a || !b) throw new Error(`contrastRatio: bad color "${fg}" / "${bg}"`);
  const l1 = relativeLuminance(a.r, a.g, a.b);
  const l2 = relativeLuminance(b.r, b.g, b.b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2 AA: 4.5:1 normal text, 3:1 large text (≥18pt or ≥14pt bold). */
export function meetsContrastAa(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) + 1e-9 >= (large ? 3 : 4.5);
}

/**
 * Brand pairs the QA gate pins so #55 can change the palette without
 * silently dropping below AA. Values match `globals.css` tokens.
 */
export const BRAND_CONTRAST_PAIRS = [
  { name: "foreground on background", fg: "#f4f7fb", bg: "#0b0d10", large: false },
  { name: "foreground on graphite", fg: "#f4f7fb", bg: "#121418", large: false },
  { name: "skip-link on cyan", fg: "#0b0d10", bg: "#7ee8ff", large: false },
  { name: "cyan ring on background", fg: "#7ee8ff", bg: "#0b0d10", large: false },
  { name: "muted zinc-400 on background", fg: "#a1a1aa", bg: "#0b0d10", large: false },
  { name: "muted zinc-400 on graphite", fg: "#a1a1aa", bg: "#121418", large: false },
] as const;

export function brandContrastFailures(): { name: string; ratio: number }[] {
  return BRAND_CONTRAST_PAIRS.filter((p) => !meetsContrastAa(p.fg, p.bg, p.large)).map((p) => ({
    name: p.name,
    ratio: contrastRatio(p.fg, p.bg),
  }));
}

/** Axe cannot measure these. Scope only — never a page-wide color-contrast disable. */
export const AXE_CONTRAST_EXCLUDE = ["canvas", "[data-visual-mask]", "[data-visual-dynamic]"] as const;

/** Stock Tailwind zinc-500+ fails AA on `--background` / `--graphite`. */
export const SUB_AA_MUTED_CLASS = /\b(?:placeholder:)?text-zinc-(?:500|600|700)\b/;

export function findSubAaMutedClass(className: string): string | null {
  const m = SUB_AA_MUTED_CLASS.exec(className);
  return m ? m[0] : null;
}
