import { FAILURE_COPY } from "../src/lib/qa-inject";
import { assertAxe, expect, MATRIX_VIEWPORTS, shot, test, ZCAT } from "./helpers";

const QUOTE_KINDS = ["quote", "quote-429", "quote-413", "quote-5xx", "quote-stale", "quote-expired", "quote-noroute"] as const;

for (const vp of MATRIX_VIEWPORTS) {
  test.describe(`failures ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("indexer inject", async ({ page }) => {
      await page.goto("/?inject=indexer");
      const alert = page.getByTestId("failure-indexer");
      await expect(alert).toBeVisible();
      await expect(alert.getByRole("heading", { name: FAILURE_COPY.indexer.title })).toBeVisible();
      await expect(alert).toContainText(/GET \/health/i);
      await expect(page.getByRole("region", { name: /Failure injection/i })).toBeVisible();
      await shot(page, `fail-indexer-${vp.name}`);
    });

    test("rpc inject", async ({ page }) => {
      await page.goto("/core?inject=rpc");
      const alert = page.getByTestId("failure-rpc");
      await expect(alert).toBeVisible();
      await expect(alert.getByRole("heading", { name: FAILURE_COPY.rpc.title })).toBeVisible();
      await expect(alert).toContainText(/5042002/);
      await shot(page, `fail-rpc-${vp.name}`);
    });

    for (const kind of QUOTE_KINDS) {
      test(`quote ${kind}`, async ({ page }) => {
        await page.goto(`${ZCAT}?inject=${kind}`);
        const alert = page.getByTestId(`failure-${kind}`);
        await expect(alert).toBeVisible();
        await expect(alert).toContainText(FAILURE_COPY[kind].body.slice(0, 24));
        await expect(page.locator("#tape li").first()).toBeVisible();
        await shot(page, `fail-${kind}-${vp.name}`);
      });
    }

    test("pricing fail-closed", async ({ page }) => {
      await page.goto("/launch?inject=pricing");
      const alert = page.getByTestId("failure-pricing");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(/SIGNER_STORE_UNAVAILABLE/);
      await shot(page, `fail-pricing-${vp.name}`);
    });

    test("upload failure", async ({ page }) => {
      await page.goto("/launch?inject=upload");
      const alert = page.getByTestId("failure-upload");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(/No StoredMedia/);
      await shot(page, `fail-upload-${vp.name}`);
    });

    test("sse disconnect reconnect no duplicate", async ({ page }) => {
      await page.goto("/?inject=sse");
      await expect(page.getByTestId("toast-sse-disconnect")).toHaveCount(1);
      await expect(page.getByTestId("toast-sse-reconnect")).toHaveCount(1);
      await expect(page.getByTestId("toast-sse-disconnect")).toHaveAttribute("role", "alert");
      await expect(page.getByTestId("toast-sse-reconnect")).toHaveAttribute("role", "status");
      await shot(page, `fail-sse-${vp.name}`);
    });

    test("empty market data", async ({ page }) => {
      await page.goto("/?inject=empty");
      await expect(page.getByTestId("markets-empty")).toBeVisible();
      await expect(page.getByTestId("failure-indexer")).toHaveCount(0);
      await shot(page, `fail-empty-${vp.name}`);
    });

    test("invalid ticker", async ({ page }) => {
      await page.goto("/launch?inject=ticker-invalid");
      await expect(page.getByTestId("failure-ticker-invalid")).toBeVisible();
      await expect(page.getByTestId("ticker-status")).toContainText(/normalize/i);
      await shot(page, `fail-ticker-invalid-${vp.name}`);
    });

    test("wallet reject", async ({ page }) => {
      await page.goto("/?inject=wallet-reject");
      await expect(page.getByTestId("failure-wallet-reject")).toBeVisible();
      await expect(page.getByTestId("failure-wallet-reject")).toContainText(/4001/);
      await shot(page, `fail-wallet-reject-${vp.name}`);
    });

    test("wallet revert", async ({ page }) => {
      await page.goto(`${ZCAT}?inject=wallet-revert`);
      await expect(page.getByTestId("failure-wallet-revert")).toBeVisible();
      await expect(page.getByTestId("failure-wallet-revert")).toContainText(/reverted/);
      await shot(page, `fail-wallet-revert-${vp.name}`);
    });
  });
}

test("failure states are axe-clean", async ({ page }) => {
  await page.goto("/?inject=indexer");
  await expect(page.getByTestId("failure-indexer")).toBeVisible();
  await assertAxe(page);

  await page.goto("/core?inject=rpc");
  await expect(page.getByTestId("failure-rpc")).toBeVisible();
  await assertAxe(page);

  await page.goto(`${ZCAT}?inject=quote-429`);
  await expect(page.getByTestId("failure-quote-429")).toBeVisible();
  await assertAxe(page);

  await page.goto("/launch?inject=pricing");
  await expect(page.getByTestId("failure-pricing")).toBeVisible();
  await assertAxe(page);
});

test("keyboard can clear inject", async ({ page }) => {
  await page.goto("/?inject=indexer");
  const clear = page.getByRole("link", { name: /^Clear$/i });
  await clear.focus();
  await expect(clear).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await expect(page.getByTestId("failure-indexer")).toHaveCount(0);
});
