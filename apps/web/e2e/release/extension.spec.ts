import { ADDR, TOKENS, WEB_URL } from "../harness/constants.mjs";
import { confirmPrompt, expect, openPrompt, rejectPrompt, test, unlockPrompt } from "../harness/extension";

test.describe("MetaMask/Rabby-style extension wallet", () => {
  test("connect + confirm trade through extension prompt", async ({ page, context, extensionId }) => {
    await page.goto(`${WEB_URL}/token/${TOKENS.NEON}`);
    await expect(page.getByRole("heading", { name: /Neon/i })).toBeVisible();
    await page.getByTestId("wallet-connect").first().click();
    await confirmPrompt(context, extensionId);
    await expect(page.getByTestId("wallet-disconnect").first()).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(page.getByTestId("trade-phase")).toHaveAttribute("data-phase", "awaiting_wallet", { timeout: 10_000 });
    await confirmPrompt(context, extensionId);
    await expect(page.getByText(/tx 0x/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("trade-phase")).toHaveAttribute("data-phase", "confirmed");
  });

  test("extension reject connect stays disconnected", async ({ page, context, extensionId }) => {
    await page.goto(`${WEB_URL}/wallet`);
    await page.getByTestId("wallet-connect").first().click();
    await rejectPrompt(context, extensionId);
    await expect(page.getByTestId("wallet-connect").first()).toBeVisible();
    await expect(page.getByTestId("wallet-disconnect")).toHaveCount(0);
  });

  test("locked extension must unlock before connect", async ({ page, context, extensionId }) => {
    await page.goto(`${WEB_URL}/wallet`);
    const lockedPrompt = await openPrompt(context, extensionId);
    await lockedPrompt.locator("#locked").check();
    await page.getByTestId("wallet-connect").first().click();
    await confirmPrompt(context, extensionId);
    await expect(page.getByTestId("wallet-disconnect")).toHaveCount(0);
    await unlockPrompt(context, extensionId);
    await page.getByTestId("wallet-connect").first().click();
    await confirmPrompt(context, extensionId);
    await expect(page.getByTestId("wallet-disconnect").first()).toBeVisible({ timeout: 15_000 });
  });

  test("extension account switch + InstantCurve buy", async ({ page, context, extensionId }) => {
    await page.goto(`${WEB_URL}/token/${TOKENS.NEON}`);
    await page.getByTestId("wallet-connect").first().click();
    await confirmPrompt(context, extensionId);
    await expect(page.getByTestId("wallet-disconnect").first()).toBeVisible({ timeout: 15_000 });
    const switchPrompt = await openPrompt(context, extensionId);
    await switchPrompt.getByRole("button", { name: /Account #1/i }).click();
    await expect(page.getByText(/0x7099/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await confirmPrompt(context, extensionId);
    await expect(page.getByText(/tx 0x/i)).toBeVisible({ timeout: 20_000 });
    expect(ADDR.InstantCurve).toMatch(/^0x/);
  });
});
