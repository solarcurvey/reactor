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

test("docs are in primary nav", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: /How REACTOR works/i })).toBeVisible();
  await expect(page.locator("header a[href='/docs']")).toHaveCount(1);
  await page.goto("/docs/traders");
  await expect(page.getByRole("heading", { name: /For traders/i })).toBeVisible();
  await page.goto("/docs/versioning");
  await expect(page.getByRole("heading", { name: /Versioning/i })).toBeVisible();
  await expect(page.getByText(/Protocol release 0\.3\.2/i)).toBeVisible();
});

test("token detail is not the homepage", async ({ page }) => {
  await page.goto("/token/0x1111111111111111111111111111111111110001");
  await expect(page.getByRole("heading", { name: /Zcash Cat|Token not found/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toHaveCount(0);
});
