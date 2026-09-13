import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;
const WEB_URL = process.env.E2E_WEB_URL ?? "http://127.0.0.1:43147";

/**
 * Production `next build` + `next start` QA gate (issue #36).
 * Shares ports and start-web.mjs with the #35 release-gate harness.
 * Review fixtures + QA inject are compiled in at build time only for this artifact.
 * Specs import `test` from `e2e/helpers` so the shared console/pageerror fixture runs.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\/(visual|states|a11y|failures)\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 60_000,
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
    baseURL: WEB_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/harness/qa-mock.mjs",
      url: "http://127.0.0.1:18448/health",
      reuseExistingServer: !ci,
      timeout: 30_000,
    },
    {
      command: "node e2e/harness/qa-rpc.mjs",
      url: "http://127.0.0.1:18545/health",
      reuseExistingServer: !ci,
      timeout: 30_000,
    },
    {
      command: "node e2e/harness/start-web.mjs",
      url: WEB_URL,
      reuseExistingServer: !ci,
      timeout: 240_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_REVIEW_FIXTURES: "1",
        NEXT_PUBLIC_QA_INJECT: "1",
        NODE_ENV: "production",
      },
    },
  ],
});
