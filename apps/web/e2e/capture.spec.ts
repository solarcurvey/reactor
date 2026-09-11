import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "../../review");
const ZCAT = "0x1111111111111111111111111111111111110001";

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
  test.use({ baseURL: process.env.CAPTURE_URL ?? "http://127.0.0.1:43149" });

  test("board pages at 1440 and 390", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
    await both(page, "home");

    await page.goto("/launch");
    await page.getByPlaceholder("Name").fill("Neon");
    await page.getByPlaceholder("Symbol").fill("NEON");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("h2").getByText(/What should your token earn/i)).toBeVisible();
    await both(page, "launch");

    await page.goto("/launch");
    await page.getByPlaceholder("Name").fill("Zcash Cat");
    await page.getByPlaceholder("Symbol").fill("ZCAT");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("USDC", { exact: true }).first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Market live immediately").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/Starting FDV/i)).toBeVisible();
    await both(page, "instant");

    await page.goto("/launch");
    await page.getByPlaceholder("Name").fill("Fair Cat");
    await page.getByPlaceholder("Symbol").fill("FCAT");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("ZEC", { exact: true }).first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Pro-rata timed sale").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/Auction share|Batch Fair Launch/i).first()).toBeVisible();
    await both(page, "fair-launch");

    await page.goto(`/token/${ZCAT}`);
    await expect(page.getByRole("heading", { name: /Zcash Cat|Token not found/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toHaveCount(0);
    await both(page, "token");

    await page.goto("/trade");
    await expect(page.getByRole("heading", { name: /^Trade$/ })).toBeVisible();
    await both(page, "trade");

    await page.goto("/rewards");
    await expect(page.getByRole("heading", { name: /Rewards/i })).toBeVisible();
    await both(page, "rewards");

    await page.goto("/reactor");
    await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
    await both(page, "reactor");

    await page.goto("/core");
    await expect(page.getByRole("heading", { name: /Fuel and burn/i })).toBeVisible();
    await both(page, "core");

    await page.goto("/fair/1");
    await expect(page.locator("h1").first()).toBeVisible();
    await both(page, "fair");

    await page.goto("/wallet");
    await expect(page.getByRole("heading", { name: /Wallet/i })).toBeVisible();
    await both(page, "wallet");
  });
});
