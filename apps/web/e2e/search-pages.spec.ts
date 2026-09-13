import { test, expect } from "@playwright/test";

type Row = {
  token: string;
  symbol: string;
  name: string;
  quote_symbol: string;
  stage: string;
  market_live: number;
  mode: number;
  rewards_mode: number;
  fdv_usd6: string;
  volume_24h_usd6: string;
  liquidity_usd6: string;
  change_24h_bps: string;
  updated_ts: number;
};

function catalog(): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= 48; i++) {
    rows.push({
      token: `0x${i.toString(16).padStart(40, "0")}`,
      symbol: `P${i.toString().padStart(2, "0")}`,
      name: `Page ${i}`,
      quote_symbol: "USDC",
      stage: "v4",
      market_live: 1,
      mode: 0,
      rewards_mode: 1,
      fdv_usd6: "1000000",
      volume_24h_usd6: String(1000 - i),
      liquidity_usd6: "500000",
      change_24h_bps: i % 2 === 0 ? "100" : "-50",
      updated_ts: 2000 - i,
    });
  }
  rows.push({
    token: "0x00000000000000000000000000000000000000ee",
    symbol: "ZLATE",
    name: "Late Hit",
    quote_symbol: "USDC",
    stage: "v4",
    market_live: 1,
    mode: 0,
    rewards_mode: 1,
    fdv_usd6: "2000000",
    volume_24h_usd6: "1",
    liquidity_usd6: "800000",
    change_24h_bps: "2400",
    updated_ts: 1,
  });
  return rows.sort((a, b) => b.updated_ts - a.updated_ts || b.token.localeCompare(a.token));
}

function pageRows(all: Row[], q: string, cursorToken: string, limit: number) {
  const needle = q.trim().toLowerCase();
  let filtered = needle
    ? all.filter(
        (r) =>
          r.symbol.toLowerCase().includes(needle) ||
          r.name.toLowerCase().includes(needle) ||
          r.token.toLowerCase().includes(needle),
      )
    : all;
  if (cursorToken) {
    const idx = filtered.findIndex((r) => r.token === cursorToken);
    filtered = idx >= 0 ? filtered.slice(idx + 1) : filtered;
  }
  const items = filtered.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    total: filtered.length + (cursorToken ? all.length - filtered.length : 0),
    has_more: filtered.length > limit,
    next_cursor: last ? { cursor_ts: String(last.updated_ts), cursor_token: last.token } : null,
    sort: "new",
    volume_24h_usd6_total: "0",
  };
}

test("search is backend-global and reaches past page 1", async ({ page }) => {
  const all = catalog();
  await page.route(/\/markets(\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("featured") === "1") {
      await route.fulfill({
        json: { bonding: null, volume: all[0] },
      });
      return;
    }
    const q = url.searchParams.get("q") ?? "";
    const cursor = url.searchParams.get("cursor_token") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? 24);
    await route.fulfill({ json: pageRows(all, q, cursor, limit) });
  });

  await page.goto("/");
  await expect(page.getByText("$P01").first()).toBeVisible();
  await expect(page.getByText("ZLATE")).toHaveCount(0);

  await page.getByPlaceholder(/Search name/i).fill("ZLATE");
  await expect(page.getByText("Late Hit")).toBeVisible();
  await expect(page.getByText(/\+24/)).toBeVisible();
  await expect(page.getByText(/^Liq$/i).first()).toBeVisible();

  await page.goto("/search");
  await page.getByPlaceholder(/Search ticker/i).fill("ZLATE");
  await expect(page.getByText("Late Hit")).toBeVisible();
});
