import { test, expect } from "@playwright/test";

test("home renders explore and ignite", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Choose a quote/i })).toBeVisible();
});

test("core dashboard reads onchain or shows error", async ({ page }) => {
  await page.goto("/core");
  await expect(page.getByRole("heading", { name: /^CORE$/ })).toBeVisible();
});

test("reactor flywheel page", async ({ page }) => {
  await page.goto("/reactor");
  await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
});

test("token detail is not the homepage", async ({ page }) => {
  await page.goto("/token/0x1111111111111111111111111111111111110001");
  await expect(page.getByRole("heading", { name: /Zcash Cat|Token not found/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toHaveCount(0);
});
