import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "../../review/visual-gate");
const HEAD = execSync("git rev-parse HEAD", { cwd: path.resolve(process.cwd(), "../..") }).toString().trim();

async function shot(page: import("@playwright/test").Page, name: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({
    path: path.join(OUT, `${HEAD.slice(0, 12)}-${name}-${w}.png`),
    fullPage: false,
  });
}

async function both(page: import("@playwright/test").Page, name: string) {
  await shot(page, name, 1440, 900);
  await shot(page, name, 390, 844);
}

test.describe("exact-commit visual gate (#40, coordinate #36)", () => {
  test("desktop + mobile signature surfaces", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
    await both(page, "discover");

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: /Find a market/i })).toBeVisible();
    await both(page, "search");

    await page.goto("/reactor");
    await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
    await both(page, "reactor");

    await page.goto("/core");
    await expect(page.getByRole("heading", { name: /^CORE$/ })).toBeVisible();
    await both(page, "core");

    await page.goto("/quote/USDC");
    await expect(page.getByRole("heading", { name: /USDC ecosystem/i })).toBeVisible();
    await both(page, "quote-usdc");

    await page.goto("/token/0x1111111111111111111111111111111111110001");
    await expect(page.getByRole("heading", { name: /Zcash Cat|Token not found|Loading/i })).toBeVisible();
    await both(page, "token-terminal");
  });

  test("designed offline / error / empty states at 1440 and 390", async ({ page }) => {
    await page.unrouteAll();
    await page.route("**/top10**", (route) => route.abort());
    await page.goto("/reactor");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      window.dispatchEvent(new Event("offline"));
    });
    await expect(page.getByText(/offline|unreachable/i).first()).toBeVisible({ timeout: 20_000 });
    await both(page, "reactor-offline");

    await page.unrouteAll();
    await page.route("**/markets**", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "fail" }) });
    });
    await page.goto("/search");
    await expect(page.locator("[data-state='error'], [data-state='offline']").first()).toBeVisible({
      timeout: 20_000,
    });
    await both(page, "search-error");

    await page.unrouteAll();
    await page.route("**/markets**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("featured") === "1") {
        await route.fulfill({ json: { bonding: null, volume: null } });
        return;
      }
      await route.fulfill({
        json: { items: [], total: 0, has_more: false, next_cursor: null, sort: "new", volume_24h_usd6_total: "0" },
      });
    });
    await page.goto("/");
    await expect(page.locator("[data-state='empty']").first()).toBeVisible({ timeout: 20_000 });
    await both(page, "discover-empty");
  });
});
