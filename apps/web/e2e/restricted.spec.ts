import { spawn } from "node:child_process";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { test, expect } from "@playwright/test";

const GEO = {
  ok: false,
  decision: "deny",
  reason: "DENY_GEO_BLOCKED",
  kind: "geo",
  error: "REACTOR-operated services are not available for this request location.",
  disclaimer:
    "REACTOR-operated services only. Public contracts remain callable onchain. Not a legal or OFAC-compliance opinion.",
  policy: "reactor-operator-policy-v1",
  writesAllowed: false,
  source: "fixture",
};

async function mockPolicy(page: import("@playwright/test").Page, body: typeof GEO) {
  await page.route("**/api/operator-policy**", async (route) => {
    await route.fulfill({
      status: body.writesAllowed ? 200 : body.decision === "unavailable" ? 503 : 403,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

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
  await mockPolicy(page, GEO);
  await page.goto("/launch");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  const launch = page.getByTestId("launch-submit");
  await expect(launch).toBeDisabled();
  await expect(launch).toHaveText(/Unavailable here/i);
  await expect(page.getByTestId("restricted-notice")).toBeVisible();

  await page.goto("/token/0x1111111111111111111111111111111111110001");
  const confirm = page.getByTestId("trade-confirm");
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText(/Unavailable here/i);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await expect(page.getByTestId("restricted-banner")).toBeVisible();
});

test("wallet and unavailable states are distinct without leaking internals", async ({ page }) => {
  await mockPolicy(page, {
    ...GEO,
    reason: "DENY_ADDRESS_BLOCKED",
    kind: "wallet",
    error: "REACTOR-operated services are not available for this account.",
  });
  await page.goto("/restricted");
  await expect(page.getByTestId("restricted-live")).toContainText(/account/i);
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "wallet");
  const html = await page.content();
  expect(html).not.toContain("SDN");
  expect(html).not.toContain("203.0.113");

  await page.unroute("**/api/operator-policy**");
  await mockPolicy(page, {
    ...GEO,
    decision: "unavailable",
    reason: "UNAVAILABLE_DATASET_STALE",
    kind: "unavailable",
    error: "Required access checks are temporarily unavailable.",
    writesAllowed: false,
  });
  await page.goto("/launch");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "unavailable");
  await expect(page.getByTestId("launch-submit")).toHaveText(/Temporarily unavailable/i);
});

const ALLOW = {
  ...GEO,
  ok: true,
  decision: "allow",
  reason: "ALLOW",
  kind: "allow",
  error: "",
  writesAllowed: true,
};

test("LOCAL page fixture query applies geo denial without a mocked policy", async ({ page }) => {
  await page.goto("/launch?fixture=DENY_GEO_BLOCKED");
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
  const launch = page.getByTestId("launch-submit");
  await expect(launch).toBeDisabled();
  await expect(launch).toHaveText(/Unavailable here/i);
});

test("allowed user keeps Launch Instant and no restricted banner", async ({ page }) => {
  const status = page.waitForResponse((res) => res.url().includes("/api/operator-policy") && res.status() < 500);
  await page.goto("/launch");
  await status;
  await expect(page.getByTestId("restricted-banner")).toHaveCount(0);
  const launch = page.getByTestId("launch-submit");
  await expect(launch).toHaveText(/Launch Instant/i);
  await expect(launch).not.toHaveText(/Unavailable here|Temporarily unavailable|Account unavailable/i);
});

test.describe("mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("geo denial disables CTAs at 390px", async ({ page }) => {
    await mockPolicy(page, GEO);
    await page.goto("/launch");
    await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", "geo");
    const launch = page.getByTestId("launch-submit");
    await expect(launch).toBeDisabled();
    await expect(launch).toHaveText(/Unavailable here/i);
    await expect(page.getByTestId("restricted-notice")).toBeVisible();
    const box = page.viewportSize();
    expect(box?.width).toBe(390);
  });
});

test("client-state allow still fails at the real #62 write gate", async ({ page }) => {
  const blocked = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const claimedClear = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const indexerCwd = process.cwd().endsWith("web") ? join(process.cwd(), "..", "indexer") : join(process.cwd(), "apps/indexer");
  const child = spawn("pnpm", ["exec", "tsx", "src/operator-policy-fixture-http.ts"], {
    cwd: indexerCwd,
    env: {
      ...process.env,
      REACTOR_ENV: "LOCAL",
      OPERATOR_POLICY_FIXTURE_PORT: "0",
      OPERATOR_POLICY_BLOCKED_WALLETS: blocked.address,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let fixtureUrl = "";
  try {
    fixtureUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("operator-policy fixture did not start")), 20_000);
      const onData = (buf: Buffer) => {
        const text = String(buf);
        const match = text.match(/listening (http:\/\/127\.0\.0\.1:\d+)/);
        if (match?.[1]) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`fixture exited ${code}`)));
    });

    await mockPolicy(page, ALLOW);
    await page.goto("/launch");
    await expect(page.getByTestId("launch-submit")).toHaveText(/Launch Instant/i);

    const challenge = await fetch(`${fixtureUrl}/operator-policy/challenge`).then((r) => r.json());
    const signature = await blocked.signMessage({ message: challenge.message as string });
    const proof = JSON.stringify({ token: challenge.token, signature });

    const gatedRes = await page.request.post(`${fixtureUrl}/launch/authorize`, {
      headers: {
        "content-type": "application/json",
        "x-reactor-wallet-proof": proof,
        "x-reactor-wallet": claimedClear,
        "x-sanctions-clear": "1",
      },
      data: { wallet: claimedClear, creator: claimedClear, sanctionsClear: true },
    });
    const gated = {
      status: gatedRes.status(),
      body: (await gatedRes.json()) as { reason?: string; ranDownstream?: boolean },
    };
    expect(gated.status).toBe(403);
    expect(gated.body.reason).toBe("DENY_ADDRESS_BLOCKED");
    expect(gated.body.ranDownstream).toBe(false);
  } finally {
    child.kill("SIGTERM");
  }
});
