import {
  assertAxe,
  assertBrandPaletteContrast,
  assertNoHorizontalOverflow,
  expect,
  NEON,
  test,
  ZCAT,
  type ConsoleGate,
  type PageDiagnostic,
} from "./helpers";
import { CTA, POLICY, mockPolicy } from "./restricted-policy";

/** Chromium logs a console.error for the official deny/unavailable HTTP status. */
function allowDeniedPolicyFetch(gate: ConsoleGate) {
  gate.allow(
    (d: PageDiagnostic) =>
      /\/api\/operator-policy/.test(d.location ?? "") && /status of (?:403|503)/.test(d.text),
  );
}

const pages = [
  { name: "home", path: "/" },
  { name: "launch", path: "/launch" },
  { name: "trade", path: "/trade" },
  { name: "reactor", path: "/reactor" },
  { name: "core", path: "/core" },
  { name: "rewards", path: "/rewards" },
  { name: "search", path: "/search" },
  { name: "token-terminal", path: ZCAT },
  { name: "token-bonding", path: NEON },
  { name: "wallet", path: "/wallet" },
  { name: "docs", path: "/docs" },
  { name: "quote-zec", path: "/quote/ZEC" },
  { name: "restricted", path: "/restricted" },
];

test("brand palette tokens meet WCAG AA", () => {
  assertBrandPaletteContrast();
});

for (const p of pages) {
  test(`axe ${p.name}`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.locator("h1").first()).toBeVisible();
    await assertAxe(page);
  });
}

test("one canonical wallet control", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByTestId("wallet-connect")).toHaveCount(1);
  await expect(page.getByTestId("wallet-menu-trigger")).toHaveCount(0);
  await page.goto("/?state=wallet-connected");
  await expect(page.getByTestId("wallet-menu-trigger")).toHaveCount(1);
  await expect(page.getByTestId("wallet-connect")).toHaveCount(0);
});

test("keyboard skip link and primary nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /Skip to main content/i });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();
});

test("keyboard filter chips", async ({ page }) => {
  await page.goto("/");
  const trending = page.getByRole("button", { name: "Trending" });
  await trending.focus();
  await expect(trending).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trending).toHaveAttribute("aria-pressed", "true");
});

test("keyboard launch form", async ({ page }) => {
  await page.goto("/launch");
  await page.getByLabel("Name").fill("Neon");
  await page.getByLabel("Ticker").fill("NEON");
  const usdc = page.getByRole("button", { name: /USDC/i }).first();
  await usdc.focus();
  await page.keyboard.press("Enter");
  await expect(usdc).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Rewards · 2% to holders/i)).toBeVisible();
});

test("keyboard trade ticket toggle", async ({ page }) => {
  await page.goto(ZCAT);
  const sell = page.getByRole("button", { name: /^sell$/i });
  await sell.focus();
  await page.keyboard.press("Enter");
  await expect(sell).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/Sell ZCAT/i)).toBeVisible();
});

test("dialog focus trap and restore", async ({ page }) => {
  await page.goto("/?state=wallet-connected");
  const trigger = page.getByTestId("wallet-menu-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByTestId("modal");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

  const inside = await page.evaluate(() => Boolean(document.activeElement?.closest("[data-testid=modal]")));
  expect(inside).toBe(true);

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const still = await page.evaluate(() => Boolean(document.activeElement?.closest("[data-testid=modal]")));
    expect(still, `Tab ${i + 1} left the dialog`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await assertAxe(page);
});

test("confirm dialog trap", async ({ page }) => {
  await page.goto(`${ZCAT}?state=dialog`);
  const dialog = page.getByTestId("modal");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const still = await page.evaluate(() => Boolean(document.activeElement?.closest("[data-testid=modal]")));
    expect(still, `Tab ${i + 1} left confirm dialog`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("axe restricted page under geo deny", async ({ page, consoleGate }) => {
  allowDeniedPolicyFetch(consoleGate);
  await mockPolicy(page, POLICY.geo);
  await page.goto("/restricted");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  await expect(page.getByTestId("restricted-live")).toBeVisible();
  await assertAxe(page);
});

test("axe launch under geo deny", async ({ page, consoleGate }) => {
  allowDeniedPolicyFetch(consoleGate);
  await mockPolicy(page, POLICY.geo);
  await page.goto("/launch");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  await expect(page.getByTestId("launch-submit")).toBeDisabled();
  await expect(page.getByTestId("launch-submit")).toHaveText(CTA.geo);
  await assertAxe(page);
});

test("axe token ticket under geo deny", async ({ page, consoleGate }) => {
  allowDeniedPolicyFetch(consoleGate);
  await mockPolicy(page, POLICY.geo);
  await page.goto(ZCAT);
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  await expect(page.getByTestId("trade-confirm")).toBeDisabled();
  await expect(page.getByTestId("trade-confirm")).toHaveText(CTA.geo);
  await assertAxe(page);
});

test("200% zoom reflow at 640 CSS px", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.goto("/launch");
  await expect(page.getByRole("heading", { name: /Ignite a market/i })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.goto(ZCAT);
  await expect(page.getByRole("heading", { name: /Zcash Cat/i })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.goto("/restricted");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("320 CSS px reflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.goto("/launch");
  await expect(page.getByLabel("Name")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.goto("/restricted");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("denied /restricted reflow at 320 CSS px", async ({ page, consoleGate }) => {
  allowDeniedPolicyFetch(consoleGate);
  await mockPolicy(page, POLICY.geo);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/restricted");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("denied launch reflow at 320 CSS px", async ({ page, consoleGate }) => {
  allowDeniedPolicyFetch(consoleGate);
  await mockPolicy(page, POLICY.geo);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/launch");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  await expect(page.getByTestId("launch-submit")).toBeDisabled();
  await assertNoHorizontalOverflow(page);
});

test("denied /restricted reflow at 200% zoom", async ({ page, consoleGate }) => {
  allowDeniedPolicyFetch(consoleGate);
  await mockPolicy(page, POLICY.geo);
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto("/restricted");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  await assertNoHorizontalOverflow(page);
});

test("denied launch reflow at 200% zoom", async ({ page, consoleGate }) => {
  allowDeniedPolicyFetch(consoleGate);
  await mockPolicy(page, POLICY.geo);
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto("/launch");
  await expect(page.getByTestId("launch-submit")).toHaveText(CTA.geo);
  await assertNoHorizontalOverflow(page);
});

test("reduced motion disables pulse", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?state=loading");
  const pulse = page.locator("[data-testid=markets-loading] .animate-pulse").first();
  await expect(pulse).toBeVisible();
  const name = await pulse.evaluate((el) => getComputedStyle(el).animationName);
  expect(name === "none" || name === "").toBe(true);
});

test("live toast semantics", async ({ page }) => {
  await page.goto("/?state=toast");
  const toast = page.getByTestId("toast-qa-live-toast");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("role", "status");
  await expect(toast).toHaveAttribute("aria-live", "polite");
  await assertAxe(page);

  await page.goto("/?inject=sse");
  const alert = page.getByTestId("toast-sse-disconnect");
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveAttribute("aria-live", "assertive");
  await expect(page.getByTestId("toast-sse-disconnect")).toHaveCount(1);
  await expect(page.getByTestId("toast-sse-reconnect")).toHaveCount(1);
});
