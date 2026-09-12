import { test, expect } from "@playwright/test";

const PAGES = [
  { path: "/docs", name: "home" },
  { path: "/docs/traders", name: "traders" },
  { path: "/docs/creators", name: "creators" },
  { path: "/docs/builders", name: "builders" },
  { path: "/docs/economics", name: "economics" },
  { path: "/docs/curve", name: "curve" },
  { path: "/docs/fees", name: "fees" },
  { path: "/docs/api", name: "api" },
  { path: "/docs/faq", name: "faq" },
  { path: "/docs/local", name: "local" },
] as const;

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
] as const;

for (const pageSpec of PAGES) {
  for (const vp of VIEWPORTS) {
    test(`${pageSpec.name} ${vp.label}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pageSpec.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.getByTestId("docs-version-badges")).toBeVisible();
      await expect(page).toHaveScreenshot(`${pageSpec.name}-${vp.label}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}
