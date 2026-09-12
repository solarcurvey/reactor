import { test, expect } from "@playwright/test";

test("production next start fail-closes operated writes without a bound policy", async ({ page }) => {
  const status = page.waitForResponse((res) => res.url().includes("/api/operator-policy"));
  await page.goto("/launch");
  await status;
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "unavailable");
  const launch = page.getByTestId("launch-submit");
  await expect(launch).toBeDisabled();
  await expect(launch).toHaveText(/Temporarily unavailable/i);
  await expect(page.getByTestId("restricted-notice")).toBeVisible();
});

test("production ignores LOCAL fixture query and claimed-wallet flags", async ({ page }) => {
  await page.goto("/launch?fixture=ALLOW&sanctionsClear=1");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "unavailable");
  await expect(page.getByTestId("launch-submit")).toHaveText(/Temporarily unavailable/i);
  const html = await page.content();
  expect(html.toLowerCase()).not.toMatch(/\b(vpn|proxy|tor|circumvent|bypass)\b/);
});
