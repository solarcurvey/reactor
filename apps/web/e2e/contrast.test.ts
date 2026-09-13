import { BRAND } from "../src/lib/brand.ts";
import {
  AXE_CONTRAST_EXCLUDE,
  BRAND_CONTRAST_PAIRS,
  brandContrastFailures,
  contrastRatio,
  findSubAaMutedClass,
  meetsContrastAa,
  parseCssColor,
} from "./contrast.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(Math.abs(contrastRatio("#ffffff", "#000000") - 21) < 0.01, "white/black is 21:1");
assert(meetsContrastAa("#ffffff", "#000000"), "white/black AA");
assert(meetsContrastAa("#ece8e1", "#12110f"), "brand paper on slag AA");
assert(meetsContrastAa("#ff6b2b", "#12110f"), "heat on slag AA");
assert(meetsContrastAa("#12110f", "#ff6b2b"), "skip-link AA");
assert(meetsContrastAa("#9aa4ad", "#12110f"), "muted steel on slag is the muted floor");
assert(!meetsContrastAa("#71717a", "#12110f"), "stock zinc-500 fails AA on slag — do not use for body/label copy");
assert(!meetsContrastAa("#52525b", "#12110f"), "stock zinc-600 fails AA on slag");
assert(parseCssColor("#12110f")?.r === 18, "hex parse");
assert(AXE_CONTRAST_EXCLUDE.includes("canvas"), "canvas excluded");
assert(AXE_CONTRAST_EXCLUDE.includes("[data-visual-mask]"), "chart/CORE mask excluded");
assert(!AXE_CONTRAST_EXCLUDE.includes("body"), "no page-wide exclude");

const fails = brandContrastFailures();
assert(fails.length === 0, `brand pairs must be AA: ${JSON.stringify(fails)}`);
assert(BRAND_CONTRAST_PAIRS.length >= 4, "pin Industrial Forge tokens");
assert(BRAND_CONTRAST_PAIRS.some((p) => p.fg === BRAND.paper && p.bg === BRAND.slag), "pairs track brand.ts slag/paper");
assert(BRAND_CONTRAST_PAIRS.some((p) => p.fg === BRAND.heat && p.bg === BRAND.slag), "pairs track brand.ts heat");
assert(findSubAaMutedClass("text-[11px] text-zinc-500") === "text-zinc-500", "detect zinc-500");
assert(findSubAaMutedClass("placeholder:text-zinc-600") === "placeholder:text-zinc-600", "detect placeholder");
assert(findSubAaMutedClass("text-zinc-400") === null, "zinc-400 is the muted floor");

console.log("contrast ok");
