import { test, expect } from "@playwright/test";

const CORE_TX = `0x${"ab".repeat(32)}`;
const TOP_TX = `0x${"cd".repeat(32)}`;
const TOKEN = `0x${"11".repeat(20)}`;

async function installMockStream(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      url: string;
      readyState = 1;
      onerror: ((ev: Event) => void) | null = null;
      private listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
        queueMicrotask(() => this.emit("hello", { ok: true, last: 0, head: 100 }, 100));
      }
      addEventListener(type: string, fn: (ev: MessageEvent) => void) {
        (this.listeners[type] ||= []).push(fn);
      }
      close() {
        this.readyState = 2;
      }
      emit(type: string, data: unknown, id: number) {
        const ev = new MessageEvent(type, { data: JSON.stringify(data) });
        Object.defineProperty(ev, "lastEventId", { value: String(id) });
        for (const fn of this.listeners[type] || []) fn(ev);
      }
    }
    // @ts-expect-error test hook
    window.EventSource = MockEventSource;
    (window as unknown as { __reactorSseEmit: (type: string, data: unknown, id: number) => void }).__reactorSseEmit = (
      type,
      data,
      id,
    ) => {
      for (const inst of MockEventSource.instances) inst.emit(type, data, id);
    };
  });
}

async function emit(page: import("@playwright/test").Page, type: string, data: unknown, id: number) {
  await page.evaluate(
    ([t, d, n]) => {
      (
        window as unknown as { __reactorSseEmit: (type: string, data: unknown, id: number) => void }
      ).__reactorSseEmit(t as string, d, n as number);
    },
    [type, data, id] as const,
  );
}

test("bottom-right toasts only confirmed live CORE and Top-10 buy+burn", async ({ page }) => {
  await installMockStream(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await expect(page.getByTestId("live-toast")).toHaveCount(0);

  await emit(page, "core", { name: "BuybackExecuted", tx: CORE_TX, confirmed: true }, 80);
  await expect(page.getByTestId("live-toast")).toHaveCount(0);

  await emit(page, "core", {
    name: "BuybackExecuted",
    tx: CORE_TX,
    quoteIn: "2500000",
    coreOut: "1000000000000000000",
    confirmed: true,
  }, 101);
  const coreToast = page.getByTestId("live-toast").filter({ hasText: /CORE buy\+burn confirmed/i });
  await expect(coreToast).toBeVisible();
  await expect(coreToast).toHaveAttribute("data-kind", "core");
  await expect(coreToast.getByRole("link", { name: /View tx/i })).toHaveAttribute("href", new RegExp(CORE_TX, "i"));

  await emit(page, "core", { name: "COREBurned", tx: CORE_TX, coreOut: "1000000000000000000", confirmed: true }, 102);
  await expect(page.getByTestId("live-toast")).toHaveCount(1);

  await emit(page, "burn", {
    name: "Top10Buy",
    tx: TOP_TX,
    token: TOKEN,
    amount: "4000000",
    burned: "2000000000000000000",
    confirmed: true,
  }, 103);
  await expect(page.getByTestId("live-toast")).toHaveCount(2);
  await expect(page.getByTestId("live-toast").filter({ hasText: /Top-10 buy\+burn confirmed/i })).toBeVisible();

  await emit(page, "burn", { name: "SelfBurnExecuted", tx: `0x${"ee".repeat(32)}`, confirmed: true }, 104);
  await emit(page, "top10", { epochId: "9", pot: "1" }, 105);
  await emit(page, "trade", { tx: TOP_TX }, 106);
  await expect(page.getByTestId("live-toast")).toHaveCount(2);

  const stack = page.getByTestId("live-toast-stack");
  const box = await stack.boundingBox();
  const vp = page.viewportSize();
  expect(box).toBeTruthy();
  expect(vp).toBeTruthy();
  if (box && vp) {
    expect(box.x + box.width).toBeGreaterThan(vp.width * 0.6);
    expect(box.y + box.height).toBeGreaterThan(vp.height * 0.7);
  }

  await page.getByRole("navigation").getByRole("link", { name: /^Reactor$/ }).click();
  await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
  await expect(page.getByTestId("live-toast")).toHaveCount(2);
});

test("live toasts sit bottom-right on mobile 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockStream(page);
  await page.goto("/core");
  await expect(page.getByRole("heading", { name: /^CORE$/ })).toBeVisible();
  await emit(page, "core", {
    name: "COREBurned",
    tx: CORE_TX,
    coreOut: "500000000000000000",
    confirmed: true,
  }, 110);
  const stack = page.getByTestId("live-toast-stack");
  await expect(stack).toBeVisible();
  const box = await stack.boundingBox();
  expect(box).toBeTruthy();
  if (box) {
    expect(box.x).toBeGreaterThan(390 - box.width - 32);
    expect(box.y).toBeGreaterThan(844 - box.height - 40);
  }
});
