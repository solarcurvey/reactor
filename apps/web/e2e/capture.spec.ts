import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "../../review");
const ZCAT = "0x1111111111111111111111111111111111110001";

const pages: { file: string; url: string; wait?: string }[] = [
  { file: "home", url: "/" },
  { file: "launch", url: "/launch" },
  { file: "instant", url: "/launch" },
  { file: "fair-launch", url: "/launch" },
  { file: "token", url: `/token/${ZCAT}` },
  { file: "trade", url: "/trade" },
  { file: "rewards", url: "/rewards" },
  { file: "reactor", url: "/reactor" },
  { file: "core", url: "/core" },
  { file: "fair", url: "/fair/1" },
  { file: "wallet", url: "/wallet" },
];

async function shot(page: import("@playwright/test").Page, name: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-${w === 1440 ? "1440" : "390"}.png`), fullPage: false });
}

test.describe("review screenshots", () => {
  test.skip(!process.env.CAPTURE, "set CAPTURE=1");

  test("board pages at 1440 and 390", async ({ page }) => {
    for (const p of pages) {
      await page.goto(p.url);
      if (p.file === "instant") {
        await page.getByPlaceholder("Name").fill("Zcash Cat");
        await page.getByPlaceholder("Symbol").fill("ZCAT");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText("USDC", { exact: true }).first().click();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText("Instant").first().click();
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText(/Starting FDV/i)).toBeVisible();
      }
      if (p.file === "fair-launch") {
        await page.getByPlaceholder("Name").fill("Fair Cat");
        await page.getByPlaceholder("Symbol").fill("FCAT");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText("ZEC", { exact: true }).first().click();
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByText("Batch Fair Launch").first().click();
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText(/Batch Fair Launch/i)).toBeVisible();
      }
      if (p.file === "launch") {
        await page.getByPlaceholder("Name").fill("Neon");
        await page.getByPlaceholder("Symbol").fill("NEON");
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText(/What should your token earn/i)).toBeVisible();
      }
      await expect(page.locator("h1")).toBeVisible();
      await shot(page, p.file === "fair-launch" ? "fair-launch" : p.file, 1440, 900);
      await shot(page, p.file === "fair-launch" ? "fair-launch" : p.file, 390, 844);
    }
  });
});
