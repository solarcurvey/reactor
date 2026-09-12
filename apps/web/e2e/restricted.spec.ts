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
