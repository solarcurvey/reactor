import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "../../review");

async function shot(page: import("@playwright/test").Page, name: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}-${w === 1440 ? "1440" : "390"}.png`), fullPage: false });
}

async function both(page: import("@playwright/test").Page, name: string) {
  await expect(page.locator("h1").first()).toBeVisible();
  await shot(page, name, 1440, 900);
  await shot(page, name, 390, 844);
}

test.describe("review screenshots", () => {
  test.skip(!process.env.CAPTURE, "set CAPTURE=1");
  test.use({ baseURL: process.env.CAPTURE_URL ?? "http://127.0.0.1:43147" });

  test("current architecture pages at 1440 and 390", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
    await both(page, "home");

    await page.goto("/launch");
    await expect(page.getByRole("heading", { name: /Ignite a market/i })).toBeVisible();
    await expect(page.getByText(/Starting FDV|Continue|creator FDV/i)).toHaveCount(0);
    await page.getByLabel("Name").fill("Neon");
    await page.getByLabel("Ticker").fill("NEON");
    await page.getByText("USDC", { exact: true }).first().click();
    await expect(page.getByText(/Rewards · 2% to holders/i)).toBeVisible();
    await expect(page.getByText(/Standard · 2% self-buy/i)).toBeVisible();
    await expect(page.getByText(/Optional Dev Buy/i)).toBeVisible();
    await both(page, "launch");

    await page.goto("/launch");
    await page.getByLabel("Name").fill("Fair Cat");
    await page.getByText("Use Batch Fair Launch instead").click();
    await expect(page.getByText(/Pro-rata timed sale/i)).toBeVisible();
    await both(page, "fair-launch");

    await page.goto("/trade");
    await expect(page.getByRole("heading", { name: /^Trade$/ })).toBeVisible();
    await both(page, "trade");

    await page.goto("/rewards");
    await expect(page.getByRole("heading", { name: /Rewards/i })).toBeVisible();
    await both(page, "rewards");

    await page.goto("/reactor");
    await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
    await expect(page.getByText(/not a trustless oracle/i)).toBeVisible();
    await both(page, "reactor");

    await page.goto("/core");
    await expect(page.getByRole("heading", { name: /^CORE$/ })).toBeVisible();
    await expect(page.getByText(/never Top-10|not Instant/i).first()).toBeVisible();
    await both(page, "core");

    await page.goto("/quote/USDC");
    await expect(page.getByRole("heading", { name: /USDC ecosystem/i })).toBeVisible();
    await both(page, "quote-usdc");

    await page.goto("/quote/ZEC");
    await expect(page.getByRole("heading", { name: /ZEC ecosystem/i })).toBeVisible();
    await both(page, "quote-zec");

    await page.goto("/wallet");
    await expect(page.getByRole("heading", { name: /Wallet/i })).toBeVisible();
    await both(page, "wallet");

    await page.goto("/fair/1");
    await expect(page.locator("h1").first()).toBeVisible();
    await both(page, "fair");
  });
});
