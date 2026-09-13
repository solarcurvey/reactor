import { defineConfig } from "@playwright/test";

const port = 43157;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /(prod-security|restricted-prod)\.spec\.ts/,
  fullyParallel: false,
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `NEXT_PUBLIC_REVIEW_FIXTURES=1 pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_REVIEW_FIXTURES: "1",
    },
  },
});
