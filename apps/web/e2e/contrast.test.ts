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
assert(meetsContrastAa("#f4f7fb", "#0b0d10"), "brand foreground AA");
assert(meetsContrastAa("#7ee8ff", "#0b0d10"), "cyan on background AA");
assert(meetsContrastAa("#0b0d10", "#7ee8ff"), "skip-link AA");
assert(meetsContrastAa("#a1a1aa", "#0b0d10"), "zinc-400 on background is the muted floor");
assert(!meetsContrastAa("#71717a", "#0b0d10"), "stock zinc-500 fails AA on background — do not use for body/label copy");
assert(!meetsContrastAa("#52525b", "#0b0d10"), "stock zinc-600 fails AA on background");
assert(parseCssColor("#0b0d10")?.r === 11, "hex parse");
assert(AXE_CONTRAST_EXCLUDE.includes("canvas"), "canvas excluded");
assert(AXE_CONTRAST_EXCLUDE.includes("[data-visual-mask]"), "chart/CORE mask excluded");
assert(!AXE_CONTRAST_EXCLUDE.includes("body"), "no page-wide exclude");

const fails = brandContrastFailures();
assert(fails.length === 0, `brand pairs must be AA: ${JSON.stringify(fails)}`);
assert(BRAND_CONTRAST_PAIRS.length >= 4, "pin the tokens #55 will edit");
assert(findSubAaMutedClass("text-[11px] text-zinc-500") === "text-zinc-500", "detect zinc-500");
assert(findSubAaMutedClass("placeholder:text-zinc-600") === "placeholder:text-zinc-600", "detect placeholder");
assert(findSubAaMutedClass("text-zinc-400") === null, "zinc-400 is the muted floor");

console.log("contrast ok");
