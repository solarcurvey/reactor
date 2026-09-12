import { expect, test, type Page, type APIResponse } from "@playwright/test";

const XSS = "0x11111111111111111111111111111111111100aa";
const LONG = "0x11111111111111111111111111111111111100ab";

const REQUIRED_HEADERS = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
};

function assertProductionHeaders(res: APIResponse) {
  const headers = res.headers();
  for (const [key, value] of Object.entries(REQUIRED_HEADERS)) {
    expect(headers[key], key).toBe(value);
  }
  const csp = headers["content-security-policy"];
  expect(csp, "live Content-Security-Policy").toBeTruthy();
  expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9]+'/);
  expect(csp).toMatch(/strict-dynamic/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
}

async function assertNoXss(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  expect(await page.locator('a[href^="data:"]').count()).toBe(0);
  expect(await page.locator('img[src^="javascript:"]').count()).toBe(0);
  expect(await page.locator("script[src*='evil']").count()).toBe(0);
  const html = await page.content();
  expect(html).not.toMatch(/<script>window\.__xss/i);
  expect(html).not.toContain("\u202E");
}

async function assertLayoutSafe(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThan(48);
}

test.describe("production headers + XSS corpus", () => {
  test("home sends production headers and sanitizes XSS/long metadata", async ({ page, request }) => {
    const res = await request.get("/");
    expect(res.ok()).toBeTruthy();
    assertProductionHeaders(res);

    await page.goto("/");
    await expect(page.getByText("XSSCat")).toBeVisible();
    await expect(page.locator('[data-untrusted="name"]').filter({ hasText: /^W+$/ }).first()).toBeVisible();
    await expect(page.locator("text=<script>")).toHaveCount(0);
    await assertNoXss(page);
    await assertLayoutSafe(page);
  });

  test("search, terminal, trade toasts, reactor activity", async ({ page, request }) => {
    for (const path of ["/search", `/token/${XSS}`, `/token/${LONG}`, "/trade", "/reactor", "/launch"]) {
      const res = await request.get(path);
      expect(res.ok(), path).toBeTruthy();
      assertProductionHeaders(res);
    }

    await page.goto("/search");
    await page.getByPlaceholder(/Search ticker/i).fill("XSS");
    await expect(page.getByText("XSSCat")).toBeVisible();
    await assertNoXss(page);

    await page.goto(`/token/${XSS}`);
    await expect(page.getByRole("heading", { name: "XSSCat" })).toBeVisible();
    await expect(page.locator("#tape")).toBeVisible();
    await expect(page.locator("#tape")).not.toContainText("<img");
    await expect(page.locator('[data-untrusted="activity"]')).toContainText("tape");
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    await assertNoXss(page);

    await page.goto(`/token/${LONG}`);
    const name = page.locator('[data-untrusted="name"]').first();
    await expect(name).toHaveText(/^W+$/);
    const box = await name.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual((viewport?.width ?? 1280) + 8);
    await assertLayoutSafe(page);
    await assertNoXss(page);

    await page.goto("/trade");
    await expect(page.getByRole("heading", { name: /Trade/i })).toBeVisible();
    await expect(page.getByText("XSSCat").or(page.locator('[data-untrusted="ticker"]')).first()).toBeVisible();
    await assertNoXss(page);

    await page.goto("/reactor");
    await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
    await expect(page.locator('[data-untrusted="activity"]')).toContainText("FlywheelAccrued");
    await expect(page.locator("text=<script>")).toHaveCount(0);
    await expect(page.getByText("$XSS")).toBeVisible();
    await assertNoXss(page);

    await page.goto("/launch");
    await page.getByPlaceholder("or paste first-party /m/…webp URL").fill("javascript:alert(1)");
    await expect(page.locator('[data-untrusted="toast"]')).toContainText(/Image URL must be/i);
    await assertNoXss(page);
  });
});
