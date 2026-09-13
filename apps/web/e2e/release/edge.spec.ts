import { ADDR, TOKENS } from "../harness/constants.mjs";
import {
  ANVIL_ACCOUNT_1,
  connectWallet,
  disconnectWallet,
  expect,
  recordedTxs,
  resetMock,
  test,
} from "../harness/wallet";

test.describe("wallet edge cases", () => {
  test.beforeEach(async ({ request }) => {
    await resetMock(request);
  });

  test("idle → quoting → approval/signature → pending → confirmed", async ({ page, request }) => {
    await resetMock(request, { reset: true, receipt: "delay", delayMs: 500 });
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    const phase = page.getByTestId("trade-phase");
    await expect(phase).toHaveAttribute("data-phase", "idle");
    await expect(phase).toHaveText(/idle/i);

    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(phase).toHaveAttribute("data-phase", /quoting|idle/);
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await expect(phase).toHaveAttribute("data-phase", "idle");

    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(phase).toHaveAttribute("data-phase", /awaiting_wallet|pending|confirmed/, { timeout: 15_000 });
    await expect(phase).toHaveText(/approval\/signature|submitted\/pending|confirmed/i);
    await expect(page.getByText(/tx 0x/i)).toBeVisible({ timeout: 20_000 });
    await expect(phase).toHaveAttribute("data-phase", "confirmed");
    await expect(phase).toHaveText(/confirmed/i);
  });

  test("disconnect then reconnect", async ({ page }) => {
    await page.goto("/wallet");
    await connectWallet(page);
    await disconnectWallet(page);
    await expect(page.getByTestId("wallet-connect")).toBeVisible();
    await connectWallet(page);
    await expect(page.locator("main").getByText(/0xf39F/i).first()).toBeVisible();
  });

  test("account switch mid-flow requires re-quote", async ({ page }) => {
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.evaluate(() => window.__reactorE2e?.switchAccount(1));
    await expect(page.getByText(/0x7099/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(page.getByText(/Account changed\. Re-quote/i)).toBeVisible();
    expect(ANVIL_ACCOUNT_1.toLowerCase().startsWith("0x7099")).toBeTruthy();
  });

  test("chain change mid-flow requires re-quote", async ({ page }) => {
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.evaluate(() => window.__reactorE2e?.setChainId(1));
    // #47 tx-guard: writesEnabled drops immediately — Confirm becomes "Wrong network" and is disabled.
    await expect(page.getByRole("button", { name: /Wrong network/i })).toBeVisible();
    await expect(page.getByText(/Wrong network|Writes are blocked|Network changed\. Re-quote/i).first()).toBeVisible();
  });

  test("locked wallet cannot connect", async ({ page }) => {
    await page.goto("/wallet");
    await page.evaluate(() => window.__reactorE2e?.lock());
    await page.getByTestId("wallet-connect").click();
    await expect(page.getByTestId("wallet-disconnect")).toHaveCount(0);
    await page.evaluate(() => window.__reactorE2e?.unlock());
    await connectWallet(page);
  });

  test("insufficient funds surfaces on confirm", async ({ page }) => {
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.evaluate(() => window.__reactorE2e?.setInsufficientFunds(true));
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(page.getByText(/insufficient funds/i)).toBeVisible({ timeout: 15_000 });
  });

  test("insufficient allowance runs approve then trade", async ({ page, request }) => {
    await resetMock(request, { reset: true, allowance: "0" });
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(page.getByText(/tx 0x/i)).toBeVisible({ timeout: 20_000 });
    const txs = await recordedTxs(page);
    expect(txs.length).toBeGreaterThanOrEqual(2);
    expect(txs.some((t) => t.data.startsWith("0x095ea7b3"))).toBeTruthy();
    expect(txs.some((t) => t.to === ADDR.InstantCurve.toLowerCase())).toBeTruthy();
  });

  test("onchain revert surfaces", async ({ page, request }) => {
    await resetMock(request, { reset: true, receipt: "revert" });
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(page.getByText(/reverted|revert/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/tx 0x/i)).toHaveCount(0);
  });

  test("dropped tx surfaces replacement copy", async ({ page, request }) => {
    await resetMock(request, { reset: true, receipt: "drop" });
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(page.getByText(/dropped or replaced/i)).toBeVisible({ timeout: 20_000 });
  });

  test("quote expiry before confirm", async ({ page }) => {
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.waitForTimeout(2800);
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(page.getByText(/Quote went stale/i)).toBeVisible({ timeout: 15_000 });
  });

  test("quote expiry while wallet prompt is open", async ({ page, request }) => {
    await resetMock(request, { reset: true, allowance: "0" });
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.evaluate(() => window.__reactorE2e?.setHoldTx(true));
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    await page.getByRole("button", { name: /Confirm buy/i }).click();
    await expect(page.getByTestId("trade-phase")).toHaveAttribute("data-phase", "awaiting_wallet", { timeout: 10_000 });
    await expect.poll(async () => page.evaluate(() => window.__reactorE2e?.pendingCount ?? 0)).toBeGreaterThan(0);
    await page.waitForTimeout(2800);
    await page.evaluate(() => window.__reactorE2e?.approvePending());
    await expect(page.getByText(/Quote went stale/i)).toBeVisible({ timeout: 15_000 });
  });

  test("rapid double-submit sends one wallet request", async ({ page }) => {
    await page.goto(`/token/${TOKENS.NEON}`);
    await connectWallet(page);
    await page.evaluate(() => window.__reactorE2e?.setHoldTx(true));
    await page.getByPlaceholder("0.0").fill("1");
    await page.getByRole("button", { name: /^Quote$/ }).click();
    await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
    const confirm = page.getByRole("button", { name: /Confirm buy/i });
    await confirm.click();
    await expect(page.getByTestId("trade-phase")).toHaveAttribute("data-phase", "awaiting_wallet", { timeout: 10_000 });
    await expect.poll(async () => page.evaluate(() => window.__reactorE2e?.pendingCount ?? 0)).toBe(1);
    await page.getByRole("button", { name: /Awaiting signature/i }).click({ force: true }).catch(() => undefined);
    await expect.poll(async () => page.evaluate(() => window.__reactorE2e?.pendingCount ?? 0)).toBe(1);
    await page.evaluate(() => window.__reactorE2e?.approvePending());
    await expect(page.getByText(/tx 0x/i)).toBeVisible({ timeout: 20_000 });
    const txs = await recordedTxs(page);
    expect(txs.length).toBe(1);
  });

  test("Dev Buy happy path hits Factory launchAndBuy", async ({ page, request }) => {
    await resetMock(request, { reset: true, allowance: "0" });
    await page.goto("/launch");
    await connectWallet(page);
    await page.getByLabel("Name").fill("DevBuy Cat");
    await page.getByLabel("Ticker").fill("DBUY");
    await page.getByText("USDC", { exact: true }).first().click();
    await page.getByLabel(/Optional Dev Buy/i).fill("1");
    await expect(page.getByTestId("launch-phase")).toHaveText(/idle/i);
    await page.getByRole("button", { name: /Launch Instant/i }).click();
    await expect(page.getByTestId("launch-phase")).toHaveAttribute("data-phase", /quoting|awaiting_wallet|pending|confirmed/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    const txs = await recordedTxs(page);
    expect(txs.some((t) => t.to === ADDR.ReactorFactory.toLowerCase())).toBeTruthy();
  });

  test("Dev Buy fails closed when authorization is down", async ({ page, request }) => {
    await resetMock(request, { reset: true, launchAuth: "fail" });
    await page.goto("/launch");
    await connectWallet(page);
    await page.getByLabel("Name").fill("NoAuth");
    await page.getByLabel("Ticker").fill("NAUTH");
    await page.getByText("USDC", { exact: true }).first().click();
    await page.getByLabel(/Optional Dev Buy/i).fill("1");
    await page.getByRole("button", { name: /Launch Instant/i }).click();
    await expect(page.getByText(/launch authorization unavailable|admission\/signer down/i)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/launch/);
  });
});
