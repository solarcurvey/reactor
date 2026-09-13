import { test as base, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachConsoleGate } from "./console-gate";
import { INDEXER_URL } from "./constants.mjs";

/** CJS-safe (Playwright compiles this file without ESM `import.meta`). cwd is `apps/web`. */
const extDir = path.resolve(process.cwd(), "e2e/extension");

export const test = base.extend<{
  context: BrowserContext;
  page: Page;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reactor-e2e-ext-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Headless shell cannot load MV3. New headless + xvfb (CI) is MetaMask/Rabby-shaped.
      headless: false,
      args: [
        "--headless=new",
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
      ],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  page: async ({ context, request }, use, testInfo) => {
    await request.post(`${INDEXER_URL}/e2e/control`, { data: { reset: true } });
    const page = context.pages()[0] ?? (await context.newPage());
    const gate = attachConsoleGate(page);
    await use(page);
    await gate.assertClean(testInfo, page);
  },
  extensionId: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await use(new URL(worker.url()).host);
  },
});

export async function openPrompt(context: BrowserContext, extensionId: string): Promise<Page> {
  const existing = context.pages().find((p) => p.url().includes("notification.html"));
  if (existing) return existing;
  const extra = await context.newPage();
  await extra.goto(`chrome-extension://${extensionId}/notification.html`);
  return extra;
}

export async function confirmPrompt(context: BrowserContext, extensionId: string) {
  const prompt = await openPrompt(context, extensionId);
  await expect(prompt.locator("#status")).toHaveText(/Connect requested|Signature:/i, { timeout: 10_000 });
  await prompt.getByRole("button", { name: /^Confirm$/i }).click();
}

export async function rejectPrompt(context: BrowserContext, extensionId: string) {
  const prompt = await openPrompt(context, extensionId);
  await expect(prompt.locator("#status")).toHaveText(/Connect requested|Signature:/i, { timeout: 10_000 });
  await prompt.getByRole("button", { name: /^Reject$/i }).click();
}

export async function unlockPrompt(context: BrowserContext, extensionId: string) {
  const prompt = await openPrompt(context, extensionId);
  await prompt.getByRole("button", { name: /^Unlock$/i }).click();
}

export { expect };
