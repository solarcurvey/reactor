import { test, expect } from "@playwright/test";

test("home renders explore and ignite", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Launch markets that pay holders/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ignite token/i })).toBeVisible();
});

test("core dashboard reads onchain or shows error", async ({ page }) => {
  await page.goto("/core");
  await expect(page.getByRole("heading", { name: /Fuel and burn/i })).toBeVisible();
});
