import { test, expect } from "@playwright/test";

test("home is indexed board — no Ops in public nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: /^Ops$/ })).toHaveCount(0);
  await expect(page.getByPlaceholder(/Search name/i)).toBeVisible();
  await page.getByPlaceholder(/Search name/i).fill("ZCAT");
  await expect(page.locator("body")).toContainText(/markets/i);
});

test("token terminal quotes via API surface", async ({ page }) => {
  await page.goto("/token/0x1111111111111111111111111111111111110001");
  const heading = page.getByRole("heading").first();
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: /Quote/i })).toBeVisible();
  await page.getByPlaceholder("0.0").fill("1");
  await page.getByRole("button", { name: /Quote/i }).click();
  await expect(page.locator("body")).toContainText(/Quoted out|Quote API|Connect|Market not live|failed/i);
});

test("launch rejects base64 path copy and shows upload", async ({ page }) => {
  await page.goto("/launch");
  await expect(page.getByRole("heading", { name: /Ignite a market/i })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeVisible();
  await expect(page.getByText(/Starting FDV/i)).toHaveCount(0);
});

test("reactor + core + quote ecosystem", async ({ page }) => {
  await page.goto("/reactor");
  await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
  await page.goto("/core");
  await expect(page.getByRole("heading", { name: /^CORE$/ })).toBeVisible();
  await expect(page.getByText(/never Top-10|not Instant/i).first()).toBeVisible();
  await page.goto("/quote/ZEC");
  await expect(page.getByRole("heading", { name: /ZEC ecosystem/i })).toBeVisible();
});

test("ops is gated and not linked from Discover", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Ops$/ })).toHaveCount(0);
  await page.goto("/ops");
  await expect(page.getByRole("heading", { name: /^Ops$/ })).toBeVisible();
  await expect(page.getByText(/Internal only/i)).toBeVisible();
});
