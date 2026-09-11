import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:43147" },
  webServer: {
    command: "NEXT_PUBLIC_REVIEW_FIXTURES=1 pnpm dev",
    url: "http://127.0.0.1:43147",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ...process.env, NEXT_PUBLIC_REVIEW_FIXTURES: "1" },
  },
});
