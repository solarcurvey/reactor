/**
 * Shared operator-policy fixtures for restricted UX e2e.
 * Import only `@playwright/test` here. Do not import e2e/helpers.ts
 * (axe-core) — apps/web tsconfig includes every `.ts` file under e2e.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

export type PublicPolicyBody = {
  ok: boolean;
  decision: "allow" | "deny" | "unavailable";
  reason: string;
  kind: "wallet" | "geo" | "unavailable" | "allow";
  error: string;
  disclaimer: string;
  policy: "reactor-operator-policy-v1";
  writesAllowed: boolean;
  source: string;
};

const DISCLAIMER =
  "REACTOR-operated services only. Public contracts remain callable onchain. Not a legal or OFAC-compliance opinion.";

function view(input: Omit<PublicPolicyBody, "disclaimer" | "policy" | "source">): PublicPolicyBody {
  return {
    ...input,
    disclaimer: DISCLAIMER,
    policy: "reactor-operator-policy-v1",
    source: "fixture",
  };
}

export const POLICY = {
  wallet: view({
    ok: false,
    decision: "deny",
    reason: "DENY_ADDRESS_BLOCKED",
    kind: "wallet",
    error: "REACTOR-operated services are not available for this account.",
    writesAllowed: false,
  }),
  geo: view({
    ok: false,
    decision: "deny",
    reason: "DENY_GEO_BLOCKED",
    kind: "geo",
    error: "REACTOR-operated services are not available for this request location.",
    writesAllowed: false,
  }),
  stale: view({
    ok: false,
    decision: "unavailable",
    reason: "UNAVAILABLE_DATASET_STALE",
    kind: "unavailable",
    error: "Required access checks are temporarily unavailable.",
    writesAllowed: false,
  }),
  allow: view({
    ok: true,
    decision: "allow",
    reason: "ALLOW",
    kind: "allow",
    error: "",
    writesAllowed: true,
  }),
} as const;

export const CTA = {
  wallet: /Account unavailable/i,
  geo: /Unavailable here/i,
  unavailable: /Temporarily unavailable/i,
  allow: /Launch Instant/i,
} as const;

export const REVIEW_TOKEN = "/token/0x1111111111111111111111111111111111110001";

export async function mockPolicy(page: Page, body: PublicPolicyBody): Promise<void> {
  await page.route("**/api/operator-policy**", async (route) => {
    await route.fulfill({
      status: body.writesAllowed ? 200 : body.decision === "unavailable" ? 503 : 403,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

export async function assertNoPolicyLeak(page: Page): Promise<void> {
  const html = await page.content();
  const lower = html.toLowerCase();
  expect(lower).not.toMatch(/\b(vpn|proxy|tor|circumvent|bypass|criminal)\b/);
  expect(html).not.toContain("SDN");
  expect(html).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
}

export async function assertRestrictedLaunch(
  page: Page,
  kind: "wallet" | "geo" | "unavailable",
): Promise<void> {
  await expect(page.getByTestId("restricted-banner")).toHaveAttribute("data-kind", kind);
  const launch = page.getByTestId("launch-submit");
  await expect(launch).toBeDisabled();
  await expect(launch).toHaveText(CTA[kind]);
  await expect(page.getByTestId("restricted-notice")).toBeVisible();
}

export async function assertAllowedLaunch(page: Page): Promise<void> {
  await expect(page.getByTestId("restricted-banner")).toHaveCount(0);
  const launch = page.getByTestId("launch-submit");
  await expect(launch).toHaveText(CTA.allow);
  await expect(launch).not.toHaveText(/Unavailable here|Temporarily unavailable|Account unavailable/i);
}

export async function assertRestrictedConfirm(
  page: Page,
  kind: "wallet" | "geo" | "unavailable",
): Promise<void> {
  const confirm = page.getByTestId("trade-confirm");
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText(CTA[kind]);
}

export async function assertHomeReadable(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
}

/** CTA/banner layout: banner stays in-flow and the page does not overflow the CSS viewport. */
export async function assertBannerCtaLayout(page: Page, kind?: "wallet" | "geo" | "unavailable"): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport?.width).toBeTruthy();
  if (kind) {
    const banner = page.getByTestId("restricted-banner");
    await expect(banner).toHaveAttribute("data-kind", kind);
    const box = await banner.boundingBox();
    expect(box, "restricted banner is laid out").toBeTruthy();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
    const launch = page.getByTestId("launch-submit");
    const ctaBox = await launch.boundingBox();
    expect(ctaBox, "launch CTA is laid out").toBeTruthy();
    expect((ctaBox?.x ?? 0) + (ctaBox?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow at this CSS width").toBeLessThanOrEqual(8);
}

/**
 * Client-state ALLOW + claimed CLEAR wallet still 403 at the real #62 fixture
 * write gate (`DENY_ADDRESS_BLOCKED`, `ranDownstream: false`).
 */
export async function assertWriteGateIgnoresClientAllow(page: Page): Promise<void> {
  const blocked = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const claimedClear = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const indexerCwd = process.cwd().endsWith("web")
    ? join(process.cwd(), "..", "indexer")
    : join(process.cwd(), "apps/indexer");
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
  try {
    const fixtureUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("operator-policy fixture did not start")), 20_000);
      const onData = (buf: Buffer) => {
        const match = String(buf).match(/listening (http:\/\/127\.0\.0\.1:\d+)/);
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

    await mockPolicy(page, POLICY.allow);
    await page.goto("/launch");
    await assertAllowedLaunch(page);

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
}
