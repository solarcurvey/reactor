import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { AXE_CONTRAST_EXCLUDE, brandContrastFailures, findSubAaMutedClass } from "./contrast";

export { test, expect } from "./qa-fixture";
export type { ConsoleGate } from "./qa-fixture";
export type { PageDiagnostic } from "./console-gate";
export { AXE_CONTRAST_EXCLUDE } from "./contrast";

/** Primary visual CI: 1440 desktop, 1280 laptop, 390 iPhone-class, 360 narrow Android. */
export const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "360", width: 360, height: 800 },
] as const;

/** State / failure matrix: one wide + one narrow Android class. */
export const MATRIX_VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "360", width: 360, height: 800 },
] as const;

export const ZCAT = "/token/0x1111111111111111111111111111111111110001";
export const NEON = "/token/0x1111111111111111111111111111111111110004";
export const DEAD = "/token/0x000000000000000000000000000000000000dEaD";

export async function stabilize(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      [data-visual-dynamic] { visibility: hidden !important; }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

export async function shot(page: Page, name: string) {
  await stabilize(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    mask: [page.locator("[data-visual-mask]")],
  });
}

export async function assertAxe(page: Page) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag21a", "wcag2aa"]);
  for (const sel of AXE_CONTRAST_EXCLUDE) builder = builder.exclude(sel);
  const results = await builder.analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  await assertNoSubAaMutedText(page);
}

/** Axe often cannot score text on the body gradient; this pins the muted floor. */
export async function assertNoSubAaMutedText(page: Page) {
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll("[class]")].flatMap((el) => {
      const cls = el.getAttribute("class") ?? "";
      return cls.split(/\s+/).filter((c) => /(?:placeholder:)?text-zinc-(?:500|600|700)/.test(c));
    }),
  );
  const bad = [...new Set(hits.filter((c) => findSubAaMutedClass(c)))];
  expect(bad, `sub-AA muted classes on ${page.url()}`).toEqual([]);
}

/** Token-level AA check. Independent of Axe's background-image / canvas limits. */
export function assertBrandPaletteContrast() {
  const fails = brandContrastFailures();
  expect(fails, JSON.stringify(fails, null, 2)).toEqual([]);
}

export async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow, "horizontal overflow at this CSS width").toBeLessThanOrEqual(8);
}
