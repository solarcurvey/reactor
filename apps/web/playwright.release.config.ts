import { defineConfig, devices } from "@playwright/test";
import { INDEXER_URL, RPC_URL, WEB_URL } from "./e2e/harness/constants.mjs";

/**
 * Production-build release gate (issue #35).
 * `next build` + `next start` — not `next dev`. No mainnet keys.
 *
 * Unexpected `console.error` / `pageerror` are not a Playwright default.
 * Both page fixtures (`e2e/harness/wallet.ts`, `e2e/harness/extension.ts`)
 * attach `attachConsoleGate` and fail teardown with the captured diagnostics.
 * Trace / screenshot / network stay retain-on-failure — keep them.
 */
export default defineConfig({
  testDir: "./e2e/release",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Shared mock JSON-RPC/indexer — one worker so receipt/allowance/auth controls cannot race.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /extension\.spec/, use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", testIgnore: /extension\.spec|edge\.spec/, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testIgnore: /extension\.spec|edge\.spec/, use: { ...devices["Desktop Safari"] } },
    {
      name: "iphone",
      testMatch: /journeys\.spec/,
      use: { ...(devices["iPhone 14"] ?? devices["iPhone 13"]), isMobile: true, hasTouch: true },
    },
    {
      name: "pixel",
      testMatch: /journeys\.spec/,
      use: {
        ...(devices["Pixel 7"] ?? devices["Pixel 5"] ?? { viewport: { width: 393, height: 851 } }),
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: "chromium-extension", testMatch: /extension\.spec/, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "node e2e/harness/mock-backend.mjs",
      url: `${INDEXER_URL}/health`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node e2e/harness/start-web.mjs",
      url: WEB_URL,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        NEXT_PUBLIC_REVIEW_FIXTURES: "1",
        NEXT_PUBLIC_INDEXER_URL: INDEXER_URL,
        NEXT_PUBLIC_RPC_URL: RPC_URL,
        NEXT_PUBLIC_QUOTE_TTL_MS: "2500",
        NEXT_PUBLIC_TX_WAIT_MS: "4000",
        INDEXER_URL,
      },
    },
  ],
});
