import { defineConfig, devices } from "@playwright/test";

/** Smoke / interactive / capture against `next dev`. Visual+a11y+failures use playwright.qa.config.ts (prod build). */

const ci = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [/visual\.spec\.ts/, /states\.spec\.ts/, /a11y\.spec\.ts/, /failures\.spec\.ts/, /prod-security\.spec\.ts/],
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.012,
      scale: "css",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:43147",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "NEXT_PUBLIC_REVIEW_FIXTURES=1 NEXT_PUBLIC_QA_INJECT=1 pnpm dev",
    url: "http://127.0.0.1:43147",
    reuseExistingServer: !ci,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_REVIEW_FIXTURES: "1",
      NEXT_PUBLIC_QA_INJECT: "1",
    },
  },
});
