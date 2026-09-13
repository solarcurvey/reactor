import { test, expect } from "@playwright/test";
import {
  POLICY,
  REVIEW_TOKEN,
  assertAllowedLaunch,
  assertNoPolicyLeak,
  assertRestrictedConfirm,
  assertRestrictedLaunch,
  assertWriteGateIgnoresClientAllow,
  mockPolicy,
} from "./restricted-policy";

test("restricted page explains controls and does not accuse or suggest bypass", async ({ page }) => {
  await page.goto("/restricted");
  await expect(page.getByRole("heading", { name: /REACTOR-operated access|Operated services/i })).toBeVisible();
  await expect(page.getByText(/cannot stop anyone from reading public chain state/i)).toBeVisible();
  await expect(page.getByText(/immutable public contracts/i)).toBeVisible();
  const article = await page.locator("main").innerText();
  expect(article.toLowerCase()).not.toMatch(/\b(vpn|proxy|tor|circumvent|bypass|criminal)\b/);
  expect(article).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
});

test("geo denial disables launch and trade CTAs and keeps public markets readable", async ({ page }) => {
  await mockPolicy(page, POLICY.geo);
  await page.goto("/launch");
  await assertRestrictedLaunch(page, "geo");

  await page.goto(REVIEW_TOKEN);
  await assertRestrictedConfirm(page, "geo");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await expect(page.getByTestId("restricted-banner")).toBeVisible();
});

test("wallet and unavailable states are distinct without leaking internals", async ({ page }) => {
  await mockPolicy(page, POLICY.wallet);
  await page.goto("/restricted");
  await expect(page.getByTestId("restricted-live")).toContainText(/account/i);
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "wallet");
  await assertNoPolicyLeak(page);

  await page.unroute("**/api/operator-policy**");
  await mockPolicy(page, POLICY.stale);
  await page.goto("/launch");
  await assertRestrictedLaunch(page, "unavailable");
});

test("LOCAL page fixture query applies geo denial without a mocked policy", async ({ page }) => {
  await page.goto("/launch?fixture=DENY_GEO_BLOCKED");
  await assertRestrictedLaunch(page, "geo");
});

test("allowed user keeps Launch Instant and no restricted banner", async ({ page }) => {
  const status = page.waitForResponse((res) => res.url().includes("/api/operator-policy") && res.status() < 500);
  await page.goto("/launch");
  await status;
  await assertAllowedLaunch(page);
});

test.describe("mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("geo denial disables CTAs at 390px", async ({ page }) => {
    await mockPolicy(page, POLICY.geo);
    await page.goto("/launch");
    await assertRestrictedLaunch(page, "geo");
    expect(page.viewportSize()?.width).toBe(390);
  });
});

test("client-state allow still fails at the real #62 write gate", async ({ page }) => {
  await assertWriteGateIgnoresClientAllow(page);
});
