import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:43147" },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:43147",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
