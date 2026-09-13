import { toFunctionSelector } from "viem";
import { ADDR, TOKENS } from "../harness/constants.mjs";
import {
  ANVIL_ACCOUNT_0,
  clickTradeAction,
  connectWallet,
  expect,
  quoteAndConfirm,
  recordedTxs,
  test,
} from "../harness/wallet";

const USER_ROUTE_BUY = toFunctionSelector(
  "function buy(address token, uint256 usdcIn, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minFinalOut, uint256 deadline)",
);
const USER_ROUTE_SELL = toFunctionSelector(
  "function sell(address token, uint256 tokenIn, (address adapter, address tokenIn, address tokenOut, uint256 minOut, bytes data)[] hops, uint256 minQuoteOut, uint256 minFinalOut, uint256 deadline)",
);

function lastTo<T extends { to: string; data: string }>(txs: T[], addr: string): T | undefined {
  return [...txs].reverse().find((t) => t.to === addr.toLowerCase());
}

function assertUserRoute(tx: { to: string; data: string; hash: string } | undefined, sel: string, label: string) {
  expect(tx, label).toBeTruthy();
  expect(tx!.data.slice(0, 10).toLowerCase(), `${label} selector`).toBe(sel.toLowerCase());
  expect(tx!.data.toLowerCase(), `${label} encodes CAT`).toContain(TOKENS.CAT.slice(2).toLowerCase());
  expect(tx!.data.toLowerCase(), `${label} encodes USDC hop`).toContain(ADDR.USDC.slice(2).toLowerCase());
  expect(tx!.hash, `${label} result hash`).toMatch(/^0x[0-9a-fA-F]{64}$/);
}

test.describe("production build — wallet journeys", () => {
  test("home + launch economics stay frozen (no FDV knobs)", async ({ page }) => {
    // iPhone WebKit reports an aborted cross-origin GET as
    // `Fetch API cannot load …/markets?limit=80 due to access control checks`
    // (run 34734308703). CORS/`connect-src` are set; leaving home while the
    // board query is in flight is the trigger. Wait for the mock `/markets`
    // response before `/launch` so the console-gate stays pinned to `/stream`.
    const markets = page.waitForResponse(
      (res) => /127\.0\.0\.1:18448\/markets(?:\?|$)/.test(res.url()) && res.ok(),
      { timeout: 15_000 },
    );
    await page.goto("/");
    await markets;
    await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
    await page.goto("/launch");
    await expect(page.getByRole("heading", { name: /Ignite a market/i })).toBeVisible();
    await expect(page.getByText(/Starting FDV/i)).toHaveCount(0);
    await expect(page.locator('input[type="range"]')).toHaveCount(0);
    await expect(page.getByText(/No creator FDV, supply, or fee knobs/i)).toBeVisible();
    await expect(page.getByText(/3\.5% from trade/i)).toBeVisible();
  });

  test("connect deterministic EIP-1193 wallet (Anvil #0, no key)", async ({ page }) => {
    await page.goto("/wallet");
    await connectWallet(page);
    // Header WalletButton is the only connect/account control; the card is status/balances.
    await expect(page.locator("main").getByText(/0xf39F/i).first()).toBeVisible();
    await expect(page.locator("body")).toContainText(/5042002/);
    await expect(page.getByText(ANVIL_ACCOUNT_0)).toHaveCount(0);
  });

  test("graduated BUY + SELL hit ReactorRouter", async ({ page }) => {
    await page.goto(`/token/${TOKENS.ZCAT}`);
    await expect(page.getByRole("heading", { name: /Zcash Cat/i })).toBeVisible();
    await connectWallet(page);
    await expect(page.getByText(/Stage:\s+graduated v4/i)).toBeVisible();
    await expect(page.getByText(/3\.5% final economics \(2 \/ 1 \/ 0\.5\)/i)).toBeVisible();

    await quoteAndConfirm(page, "buy");
    let txs = await recordedTxs(page);
    expect(lastTo(txs, ADDR.ReactorRouter), "graduated BUY → router.swap").toBeTruthy();

    await quoteAndConfirm(page, "sell");
    txs = await recordedTxs(page);
    const sells = txs.filter((t) => t.to === ADDR.ReactorRouter.toLowerCase());
    expect(sells.length).toBeGreaterThanOrEqual(2);
  });

  test("bonding BUY + SELL hit InstantCurve", async ({ page }) => {
    await page.goto(`/token/${TOKENS.NEON}`);
    await expect(page.getByRole("heading", { name: /Neon/i })).toBeVisible();
    await connectWallet(page);
    await expect(page.getByText(/Stage:\s+bonding InstantCurve/i)).toBeVisible();
    await expect(page.getByText(/bonded/i).first()).toBeVisible();

    await quoteAndConfirm(page, "buy");
    let txs = await recordedTxs(page);
    expect(lastTo(txs, ADDR.InstantCurve), "bonding BUY → curve.buy").toBeTruthy();

    await quoteAndConfirm(page, "sell");
    txs = await recordedTxs(page);
    expect(txs.filter((t) => t.to === ADDR.InstantCurve.toLowerCase()).length).toBeGreaterThanOrEqual(2);
  });

  test("nested USDC BUY + SELL hit UserRouteExecutor calldata", async ({ page }) => {
    await page.goto(`/token/${TOKENS.CAT}`);
    await expect(page.getByRole("heading", { name: /^Cat$/i })).toBeVisible();
    await connectWallet(page);
    await expect(page.getByText(/Pay USDC \(nested route/i)).toBeVisible();
    await page.getByText(/Pay USDC \(nested route/i).click();
    await expect(page.getByText(/3\.5% final economics \(2 \/ 1 \/ 0\.5\)/i)).toBeVisible();

    await quoteAndConfirm(page, "buy");
    let txs = await recordedTxs(page);
    assertUserRoute(lastTo(txs, ADDR.UserRouteExecutor), USER_ROUTE_BUY, "nested BUY → UserRouteExecutor.buy");

    await quoteAndConfirm(page, "sell");
    txs = await recordedTxs(page);
    const sells = txs.filter((t) => t.to === ADDR.UserRouteExecutor.toLowerCase() && t.data.slice(0, 10).toLowerCase() === USER_ROUTE_SELL.toLowerCase());
    expect(sells.length, "nested SELL sent UserRouteExecutor.sell").toBeGreaterThanOrEqual(1);
    assertUserRoute(sells.at(-1), USER_ROUTE_SELL, "nested SELL → UserRouteExecutor.sell");
  });

  test("ready market offers graduate to locked v4", async ({ page }) => {
    await page.goto(`/token/${TOKENS.RDY}`);
    await expect(page.getByRole("heading", { name: /^Ready$/i })).toBeVisible();
    await connectWallet(page);
    await expect(page.getByRole("button", { name: /Graduate to locked v4/i })).toBeVisible();
    await clickTradeAction(page, /Graduate to locked v4/i);
    await expect(page.getByText(/tx 0x/i)).toBeVisible({ timeout: 20_000 });
    const txs = await recordedTxs(page);
    expect(lastTo(txs, ADDR.InstantCurve), "graduate → InstantCurve").toBeTruthy();
  });

  test("launch Instant submits Factory tx", async ({ page }) => {
    await page.goto("/launch");
    await connectWallet(page);
    await page.getByLabel("Name").fill("E2E Neon");
    await page.getByLabel("Ticker").fill("E2EN");
    await page.getByText("USDC", { exact: true }).first().click();
    await expect(page.getByText(/Rewards · 2% to holders/i)).toBeVisible();
    await expect(page.getByText(/No creator FDV, supply, or fee knobs/i)).toBeVisible();
    await page.getByRole("button", { name: /Launch Instant/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    const txs = await recordedTxs(page);
    expect(lastTo(txs, ADDR.ReactorFactory), "launch → Factory").toBeTruthy();
  });

  test("rewards page + claim", async ({ page }) => {
    await page.goto("/rewards");
    await expect(page.getByRole("heading", { name: /Rewards/i })).toBeVisible();
    await expect(page.getByText(/Wallet disconnected/i)).toBeVisible();
    await connectWallet(page);
    await expect(page.getByText(/Wallet disconnected/i)).toHaveCount(0);
    await expect(page.getByText(/\$ZCAT|\$NEON|\$BOND/i).first()).toBeVisible();

    await page.goto(`/token/${TOKENS.ZCAT}`);
    await expect(page.getByText(/Holder rewards/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Claim$/i })).toBeEnabled({ timeout: 15_000 });
    await clickTradeAction(page, /^Claim$/i);
    await expect(page.getByText(/Claimed\.|tx 0x/i)).toBeVisible({ timeout: 20_000 });
    const txs = await recordedTxs(page);
    expect(lastTo(txs, TOKENS.ZCAT), "claimRewards on token").toBeTruthy();
  });
});

test.describe("wrong chain + user reject", () => {
  test.describe("wrong network", () => {
    test.use({ walletOptions: { chainId: 1 } });

    test("banner and switch restore local chain 5042002", async ({ page }) => {
      await page.goto("/");
      const connect = page.getByTestId("wallet-connect");
      await expect(connect).toBeVisible({ timeout: 20_000 });
      await connect.click();
      await expect(page.getByText(/Wrong network/i)).toBeVisible();
      await expect(page.getByTestId("wallet-switch")).toBeVisible();
      await page.getByTestId("wallet-switch").click();
      await expect(page.getByTestId("wallet-menu-trigger")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Wrong network/i)).toHaveCount(0);
    });
  });

  test.describe("user rejects connect", () => {
    test.use({ walletOptions: { rejectConnect: true } });

    test("connect stays disconnected on 4001", async ({ page }) => {
      await page.goto("/wallet");
      await page.getByTestId("wallet-connect").click();
      await expect(page.getByTestId("wallet-connect")).toBeVisible();
      await expect(page.getByTestId("wallet-disconnect")).toHaveCount(0);
    });
  });

  test.describe("user rejects transaction", () => {
    test.use({ walletOptions: { rejectTx: true } });

    test("Confirm buy surfaces rejection", async ({ page }) => {
      await page.goto(`/token/${TOKENS.NEON}`);
      await connectWallet(page);
      await page.getByPlaceholder("0.0").fill("1");
      await clickTradeAction(page, /^Quote$/);
      await expect(page.locator("body")).toContainText(/Quoted out:\s+\d/i, { timeout: 15_000 });
      await clickTradeAction(page, /Confirm buy/i);
      await expect(page.getByText(/rejected|User rejected|4001/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/tx 0x/i)).toHaveCount(0);
    });
  });
});
