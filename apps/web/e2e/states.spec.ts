import { DEAD, expect, MATRIX_VIEWPORTS, shot, test, ZCAT } from "./helpers";

for (const vp of MATRIX_VIEWPORTS) {
  test.describe(`states ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("discover loading", async ({ page }) => {
      await page.goto("/?state=loading");
      await expect(page.getByTestId("markets-loading")).toBeVisible();
      await shot(page, `state-loading-${vp.name}`);
    });

    test("discover empty", async ({ page }) => {
      await page.goto("/?state=empty");
      await expect(page.getByTestId("markets-empty")).toBeVisible();
      await shot(page, `state-empty-${vp.name}`);
    });

    test("discover search", async ({ page }) => {
      await page.goto("/?state=search");
      await expect(page.getByLabel(/Search name/i)).toHaveValue("ZCAT");
      await expect(page.getByRole("link", { name: /Zcash Cat/i })).toBeVisible();
      await shot(page, `state-search-${vp.name}`);
    });

    test("discover filter bonding", async ({ page }) => {
      await page.goto("/?state=filter-bonding");
      await expect(page.getByRole("button", { name: "Bonding" })).toHaveAttribute("aria-pressed", "true");
      await shot(page, `state-filter-bonding-${vp.name}`);
    });

    test("launch ticker reserved", async ({ page }) => {
      await page.goto("/launch?state=ticker-reserved");
      await expect(page.getByTestId("ticker-status")).toContainText(/reserved/i);
      await shot(page, `state-ticker-reserved-${vp.name}`);
    });

    test("launch ticker available", async ({ page }) => {
      await page.goto("/launch?state=ticker-available");
      await expect(page.getByTestId("ticker-status")).toContainText(/available/i);
      await shot(page, `state-ticker-available-${vp.name}`);
    });

    test("launch standard", async ({ page }) => {
      await page.goto("/launch?state=standard");
      await page.getByRole("button", { name: /USDC/i }).first().click();
      const standard = page.getByRole("button", { name: /Standard · 2% self-buy/i });
      await expect(standard).toHaveAttribute("aria-pressed", "true");
      await standard.scrollIntoViewIfNeeded();
      await shot(page, `state-standard-${vp.name}`);
    });

    test("launch rewards", async ({ page }) => {
      await page.goto("/launch?state=rewards");
      await page.getByRole("button", { name: /USDC/i }).first().click();
      const rewards = page.getByRole("button", { name: /Rewards · 2% to holders/i });
      await expect(rewards).toHaveAttribute("aria-pressed", "true");
      await rewards.scrollIntoViewIfNeeded();
      await shot(page, `state-rewards-${vp.name}`);
    });

    test("launch dev buy", async ({ page }) => {
      await page.goto("/launch?state=devbuy");
      await page.getByRole("button", { name: /USDC/i }).first().click();
      const devBuy = page.getByLabel(/Optional Dev Buy/i);
      await expect(devBuy).toHaveValue("50");
      await devBuy.scrollIntoViewIfNeeded();
      await shot(page, `state-devbuy-${vp.name}`);
    });

    test("launch upload ok", async ({ page }) => {
      await page.goto("/launch?state=upload-ok");
      await expect(page.getByTestId("launch-upload-preview")).toBeVisible();
      await shot(page, `state-upload-ok-${vp.name}`);
    });

    test("tx pending", async ({ page }) => {
      await page.goto(`${ZCAT}?state=tx-pending`);
      await expect(page.getByTestId("tx-pending")).toBeVisible();
      await shot(page, `state-tx-pending-${vp.name}`);
    });

    test("tx confirmed", async ({ page }) => {
      await page.goto(`${ZCAT}?state=tx-confirmed`);
      await expect(page.getByTestId("tx-confirmed")).toBeVisible();
      await shot(page, `state-tx-confirmed-${vp.name}`);
    });

    test("tx reverted", async ({ page }) => {
      await page.goto(`${ZCAT}?state=tx-reverted`);
      await expect(page.getByTestId("tx-reverted")).toBeVisible();
      await shot(page, `state-tx-reverted-${vp.name}`);
    });

    test("wallet account menu", async ({ page }) => {
      await page.goto("/?state=wallet-menu");
      await expect(page.getByTestId("modal")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
      await shot(page, `state-wallet-menu-${vp.name}`);
    });

    test("confirm dialog", async ({ page }) => {
      await page.goto(`${ZCAT}?state=dialog`);
      await expect(page.getByTestId("modal")).toBeVisible();
      await expect(page.getByRole("heading", { name: /Confirm trade/i })).toBeVisible();
      await shot(page, `state-dialog-${vp.name}`);
    });

    test("live toast", async ({ page }) => {
      await page.goto("/?state=toast");
      await expect(page.getByTestId("toast-qa-live-toast")).toBeVisible();
      await shot(page, `state-toast-${vp.name}`);
    });

    test("invalid token", async ({ page }) => {
      await page.goto(`${DEAD}?inject=token-invalid`);
      await expect(page.getByTestId("failure-token-invalid")).toBeVisible();
      await shot(page, `state-token-invalid-${vp.name}`);
    });
  });
}
