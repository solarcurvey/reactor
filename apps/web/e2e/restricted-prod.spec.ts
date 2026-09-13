import { test, expect } from "@playwright/test";
import {
  CTA,
  POLICY,
  REVIEW_TOKEN,
  assertAllowedLaunch,
  assertBannerCtaLayout,
  assertHomeReadable,
  assertNoPolicyLeak,
  assertRestrictedConfirm,
  assertRestrictedLaunch,
  assertWriteGateIgnoresClientAllow,
  mockPolicy,
} from "./restricted-policy";

/**
 * Production `next build` + `next start` (#65 AC).
 * LOCAL `?fixture=` is ignored, so denied/allow states mock `GET /api/operator-policy`
 * against the production-built pages (CTA / banner / notice still run that artifact).
 * Fail-closed and ignored-flag cases stay unmocked.
 */

test("production next start fail-closes operated writes without a bound policy", async ({ page }) => {
  const status = page.waitForResponse((res) => res.url().includes("/api/operator-policy"));
  await page.goto("/launch");
  await status;
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "unavailable");
  const launch = page.getByTestId("launch-submit");
  await expect(launch).toBeDisabled();
  await expect(launch).toHaveText(CTA.unavailable);
  await expect(page.getByTestId("restricted-notice")).toBeVisible();
});

test("production ignores LOCAL fixture query and claimed-wallet flags", async ({ page }) => {
  await page.goto("/launch?fixture=ALLOW&sanctionsClear=1");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "unavailable");
  await expect(page.getByTestId("launch-submit")).toHaveText(CTA.unavailable);
  await assertNoPolicyLeak(page);
});

test.describe("production policy matrix (desktop)", () => {
  test("blocked wallet disables Launch and /restricted without leaking internals", async ({ page }) => {
    await mockPolicy(page, POLICY.wallet);
    await page.goto("/restricted");
    await expect(page.getByTestId("restricted-live")).toContainText(/account/i);
    await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "wallet");
    await assertNoPolicyLeak(page);

    await page.goto("/launch");
    await assertRestrictedLaunch(page, "wallet");
    await assertBannerCtaLayout(page, "wallet");
    await assertNoPolicyLeak(page);
  });

  test("blocked geo disables launch and trade CTAs and keeps public markets readable", async ({ page }) => {
    await mockPolicy(page, POLICY.geo);
    await page.goto("/launch");
    await assertRestrictedLaunch(page, "geo");
    await assertBannerCtaLayout(page, "geo");

    await page.goto(REVIEW_TOKEN);
    await assertRestrictedConfirm(page, "geo");
    await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");

    await page.goto("/");
    await assertHomeReadable(page);
    await expect(page.getByTestId("restricted-banner")).toBeVisible();
    await assertNoPolicyLeak(page);
  });

  test("stale / unavailable dataset disables writes as temporarily unavailable", async ({ page }) => {
    await mockPolicy(page, POLICY.stale);
    await page.goto("/launch");
    await assertRestrictedLaunch(page, "unavailable");
    await assertBannerCtaLayout(page, "unavailable");
    await assertNoPolicyLeak(page);
  });

  test("allowed user keeps Launch Instant and no restricted banner", async ({ page }) => {
    await mockPolicy(page, POLICY.allow);
    await page.goto("/launch");
    await assertAllowedLaunch(page);
    await assertBannerCtaLayout(page);
  });
});

test.describe("production policy matrix (mobile 390)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("blocked wallet CTA/banner layout at 390px", async ({ page }) => {
    await mockPolicy(page, POLICY.wallet);
    await page.goto("/launch");
    await assertRestrictedLaunch(page, "wallet");
    await assertBannerCtaLayout(page, "wallet");
    expect(page.viewportSize()?.width).toBe(390);
  });

  test("blocked geo CTA/banner layout at 390px", async ({ page }) => {
    await mockPolicy(page, POLICY.geo);
    await page.goto("/launch");
    await assertRestrictedLaunch(page, "geo");
    await assertBannerCtaLayout(page, "geo");

    await page.goto(REVIEW_TOKEN);
    await assertRestrictedConfirm(page, "geo");
    await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  });

  test("stale / unavailable CTA/banner layout at 390px", async ({ page }) => {
    await mockPolicy(page, POLICY.stale);
    await page.goto("/launch");
    await assertRestrictedLaunch(page, "unavailable");
    await assertBannerCtaLayout(page, "unavailable");
  });

  test("allowed user has no banner and Launch Instant at 390px", async ({ page }) => {
    await mockPolicy(page, POLICY.allow);
    await page.goto("/launch");
    await assertAllowedLaunch(page);
    await assertBannerCtaLayout(page);
    expect(page.viewportSize()?.width).toBe(390);
  });
});

test("client-state allow still fails at the real #62 write gate", async ({ page }) => {
  await assertWriteGateIgnoresClientAllow(page);
});
