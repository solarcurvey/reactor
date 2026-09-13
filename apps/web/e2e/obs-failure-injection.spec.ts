import { test, expect } from "@playwright/test";
import { ANVIL_ACCOUNT0_PK } from "../src/lib/secret-sentinel";
import { anvilMnemonic } from "../src/lib/obs/inject-sentinels";
import { PROTOCOL_VERSION, RELEASE_PREFIX } from "./protocol-version";

const ANVIL_PK = `0x${ANVIL_ACCOUNT0_PK}`;
const MNEMONIC = anvilMnemonic();

const OUTAGE_INJECTS = [
  { name: /Inject render outage/i, kind: "ui", outageClass: "render" },
  { name: /Inject API outage/i, kind: "api", outageClass: "api" },
  { name: /Inject RPC outage/i, kind: "rpc", outageClass: "rpc" },
  { name: /Inject quote outage/i, kind: "quote", outageClass: "quote" },
  { name: /Inject SSE outage/i, kind: "sse", outageClass: "sse" },
  { name: /Inject simulation outage/i, kind: "simulation", outageClass: "simulation" },
] as const;

async function captureTelemetry(page: import("@playwright/test").Page) {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/api/telemetry", async (route) => {
    const raw = route.request().postData() ?? "{}";
    posts.push(JSON.parse(raw) as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, release: `reactor@${PROTOCOL_VERSION}+e2e` }),
    });
  });
  return posts;
}

function assertNoSecrets(blob: string) {
  expect(blob.includes(ANVIL_PK)).toBeFalsy();
  expect(blob.includes(ANVIL_PK.slice(2))).toBeFalsy();
  expect(blob.includes(MNEMONIC)).toBeFalsy();
  expect(blob.includes("cf-inject-secret")).toBeFalsy();
}

test("version endpoint exposes exact env/chain/build tags", async ({ request }) => {
  const res = await request.get("/api/version");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    release?: string;
    protocolVersion?: string;
    reactorEnv?: string;
    chainId?: number;
    chainName?: string;
    buildTimestamp?: string;
    buildSha?: string;
    mainnet?: boolean;
    audited?: boolean;
  };
  expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  expect(body.release).toMatch(RELEASE_PREFIX);
  expect(body.chainId).toBe(5042002);
  expect(body.chainName).toBe("REACTOR local (Arc-compatible)");
  expect(typeof body.reactorEnv).toBe("string");
  expect(body.reactorEnv).toMatch(/^(LOCAL|TEST|TESTNET|PROD)$/);
  expect(typeof body.buildTimestamp).toBe("string");
  expect(body.buildTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(typeof body.buildSha).toBe("string");
  expect(body.buildSha.length).toBeGreaterThan(2);
  expect(body.mainnet).toBe(false);
  expect(body.audited).toBe(false);
});

test("core-page Web Vitals are recorded on /trade", async ({ page }) => {
  const posts = await captureTelemetry(page);
  await page.goto("/trade");
  await expect.poll(() => posts.some((p) => p.kind === "perf"), { timeout: 15_000 }).toBeTruthy();
  const perf = posts.find((p) => p.kind === "perf");
  expect(perf).toBeTruthy();
  expect(String(perf?.message ?? "")).toMatch(/^(LCP|INP|CLS|FCP|TTFB) /);
  expect(perf?.chainId).toBe(5042002);
  expect(perf?.protocolVersion).toBe(PROTOCOL_VERSION);
  expect(String(perf?.release)).toMatch(RELEASE_PREFIX);
  expect(perf?.page).toBe(false);
});

test("ops runbook lists render/api/rpc/quote/sse/simulation thresholds", async ({ page }) => {
  await page.goto("/ops");
  await expect(page.getByText("Web outage paging")).toBeVisible();
  const table = page.locator("table");
  for (const cls of ["render", "api", "rpc", "quote", "sse", "simulation"]) {
    await expect(table.getByText(cls, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/4001/)).toBeVisible();
});

test("failure injection fires every outage-class hook and redacts secret sentinels", async ({ page }) => {
  const posts = await captureTelemetry(page);

  await page.goto("/obs-inject");
  await expect(page.getByRole("heading", { name: /Telemetry failure injection/i })).toBeVisible();

  for (const row of OUTAGE_INJECTS) {
    await page.getByRole("button", { name: row.name }).click();
    await expect.poll(() => posts.some((p) => p.kind === row.kind)).toBeTruthy();
    const ev = posts.find((p) => p.kind === row.kind);
    expect(ev?.outageClass).toBe(row.outageClass);
    expect(ev?.chainId).toBe(5042002);
    expect(ev?.chainName).toBe("REACTOR local (Arc-compatible)");
    expect(ev?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(String(ev?.release)).toMatch(RELEASE_PREFIX);
    expect(typeof ev?.traceId).toBe("string");
  }

  await page.getByRole("button", { name: /Inject wallet 4001/i }).click();
  await expect.poll(() => posts.some((p) => p.kind === "wallet")).toBeTruthy();

  assertNoSecrets(JSON.stringify(posts));

  const wallet = posts.find((p) => p.kind === "wallet");
  expect(wallet?.page).toBe(false);
  expect(String(wallet?.pagingReason)).toMatch(/4001|user-rejection/);
});

test("user-visible quote failure shows correlation ref matching telemetry", async ({ page }) => {
  const posts = await captureTelemetry(page);
  await page.route("**/quote", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        reason: `Quote API unavailable pk=${ANVIL_PK}`,
      }),
    });
  });

  await page.goto("/obs-inject");
  await page.getByRole("button", { name: /Inject quote outage/i }).click();
  await expect.poll(() => posts.length).toBeGreaterThan(0);
  const ev = posts.find((p) => p.kind === "quote");
  expect(ev).toBeTruthy();
  await expect(page.locator("pre")).toContainText("ref ");
  await expect(page.locator("pre")).toContainText(String(ev?.traceId ?? "missing"));
  await expect(page.locator("pre")).toContainText("5042002");
  assertNoSecrets(JSON.stringify(posts));
});
