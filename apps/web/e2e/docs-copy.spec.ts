import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

function repoRoot(): string {
  const candidates = [process.cwd(), join(process.cwd(), ".."), join(process.cwd(), "..", "..")];
  for (const c of candidates) {
    if (existsSync(join(c, "docs", "version.json"))) return c;
  }
  return candidates[0]!;
}
const root = repoRoot();
const ver = JSON.parse(readFileSync(join(root, "docs", "version.json"), "utf8")) as {
  protocolVersion: string;
  factoryVersionLabel: string;
};
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const api = JSON.parse(readFileSync(join(root, "apps", "indexer", "package.json"), "utf8")) as { version: string };
const sdk = JSON.parse(readFileSync(join(root, "packages", "sdk", "package.json"), "utf8")) as { version: string };

test.describe("docs code-copy + badge matrix + body search", () => {
  test.use({
    permissions: ["clipboard-read", "clipboard-write"],
  });

  test("copy button writes fence contents and shows Copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/docs/examples");
    const btn = page.getByTestId("docs-copy").first();
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/Copy/i);
    await btn.click();
    await expect(btn).toHaveText(/Copied/i);
    const text = await page.evaluate(async () => navigator.clipboard.readText());
    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/curl|ReactorClient|quote/i);
  });

  test("sidebar + footer expose protocol Factory API SDK source", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByTestId("badge-protocol")).toHaveText(`Protocol ${ver.protocolVersion}`);
    await expect(page.getByTestId("badge-factory")).toHaveText(`Factory ${ver.factoryVersionLabel}`);
    await expect(page.getByTestId("badge-api")).toHaveText(`API ${api.version}`);
    await expect(page.getByTestId("badge-sdk")).toHaveText(`SDK ${sdk.version}`);
    await expect(page.getByTestId("badge-source")).toHaveText(`Source v${rootPkg.version}`);
    await expect(page.getByTestId("docs-footer-badges")).toContainText(`Protocol ${ver.protocolVersion}`);
    await expect(page.getByTestId("docs-footer-badges")).toContainText(`API ${api.version}`);
    await expect(page.getByTestId("docs-footer-badges")).toContainText(`SDK ${sdk.version}`);
    await expect(page.getByTestId("docs-footer-badges")).toContainText(`Source v${rootPkg.version}`);
  });

  test("sidebar search finds a body-only curve constant", async ({ page }) => {
    await page.goto("/docs");
    await page.getByTestId("docs-search").fill("5365128027");
    await expect(page.getByTestId("docs-sidebar").getByRole("link", { name: "Curve math" })).toBeVisible();
    await expect(page.getByTestId("docs-sidebar").getByRole("link", { name: "Traders" })).toHaveCount(0);
  });
});
