import { expect, NEON, VIEWPORTS, ZCAT, shot, test } from "./helpers";

for (const vp of VIEWPORTS) {
  test.describe(`visual ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("home board", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
      await shot(page, `home-${vp.name}`);
    });

    test("instant launch", async ({ page }) => {
      await page.goto("/launch");
      await expect(page.getByRole("heading", { name: /Ignite a market/i })).toBeVisible();
      await page.getByLabel("Name").fill("Neon");
      await page.getByLabel("Ticker").fill("NEON");
      await page.getByRole("button", { name: /USDC/i }).first().click();
      await expect(page.getByText(/Rewards · 2% to holders/i)).toBeVisible();
      await shot(page, `launch-${vp.name}`);
    });

    test("fair launch form", async ({ page }) => {
      await page.goto("/launch");
      await page.getByLabel("Name").fill("Fair Cat");
      await page.getByRole("button", { name: /Use Batch Fair Launch instead/i }).click();
      await expect(page.getByText(/Pro-rata timed sale/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /USDC/i }).first()).toBeVisible();
      await page.getByRole("heading", { name: /Ignite a market/i }).scrollIntoViewIfNeeded();
      await shot(page, `fair-launch-${vp.name}`);
    });

    test("token terminal", async ({ page }) => {
      await page.goto(ZCAT);
      await expect(page.getByRole("heading", { name: /Zcash Cat/i })).toBeVisible();
      await shot(page, `token-terminal-${vp.name}`);
    });

    test("token bonding", async ({ page }) => {
      await page.goto(NEON);
      await expect(page.getByRole("heading", { name: /Neon/i })).toBeVisible();
      await shot(page, `token-bonding-${vp.name}`);
    });

    test("reactor", async ({ page }) => {
      await page.goto("/reactor");
      await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
      await shot(page, `reactor-${vp.name}`);
    });

    test("core", async ({ page }) => {
      await page.goto("/core");
      await expect(page.getByRole("heading", { name: /^CORE$/ })).toBeVisible();
      await shot(page, `core-${vp.name}`);
    });

    test("trade", async ({ page }) => {
      await page.goto("/trade");
      await expect(page.getByRole("heading", { name: /^Trade$/ })).toBeVisible();
      await shot(page, `trade-${vp.name}`);
    });

    test("quote ecosystem", async ({ page }) => {
      await page.goto("/quote/ZEC");
      await expect(page.getByRole("heading", { name: /ZEC ecosystem/i })).toBeVisible();
      await shot(page, `quote-zec-${vp.name}`);
    });

    test("qa inject panel", async ({ page }) => {
      await page.goto("/?qa=1");
      await expect(page.getByRole("region", { name: /Failure injection/i })).toBeVisible();
      await shot(page, `qa-inject-${vp.name}`);
    });
  });
}
