import { test, expect } from "@playwright/test";

const CHAIN = 5042002;
const CORE_TX = `0x${"ab".repeat(32)}`;
const TOP_TX = `0x${"cd".repeat(32)}`;
const TOKEN = `0x${"11".repeat(20)}`;

function ident(eventKind: string, tx: string, logIndex: number) {
  return {
    name: eventKind,
    eventKind,
    tx,
    chainId: CHAIN,
    logIndex,
    confirmed: true as const,
  };
}

async function installMockStream(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      static helloHead = 100;
      url: string;
      readyState = 1;
      onerror: ((ev: Event) => void) | null = null;
      private listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
        (window as unknown as { __reactorLastStreamUrl: string }).__reactorLastStreamUrl = url;
        queueMicrotask(() => this.emit("hello", { ok: true, last: 0, head: MockEventSource.helloHead }));
      }
      addEventListener(type: string, fn: (ev: MessageEvent) => void) {
        (this.listeners[type] ||= []).push(fn);
      }
      close() {
        this.readyState = 2;
      }
      emit(type: string, data: unknown, id?: number) {
        const ev = new MessageEvent(type, { data: JSON.stringify(data) });
        Object.defineProperty(ev, "lastEventId", { value: id == null ? "" : String(id) });
        for (const fn of this.listeners[type] || []) fn(ev);
      }
    }
    const w = window as unknown as {
      EventSource: typeof MockEventSource;
      __reactorSseRetryMs: number;
      __reactorSseEmit: (type: string, data: unknown, id?: number) => void;
      __reactorSseError: () => void;
      __reactorSseSetHelloHead: (n: number) => void;
      fetch: typeof fetch;
    };
    w.EventSource = MockEventSource;
    w.__reactorSseRetryMs = 20;
    const origFetch = window.fetch.bind(window);
    w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/health")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return origFetch(input, init);
    }) as typeof fetch;
    w.__reactorSseEmit = (type, data, id) => {
      for (const inst of MockEventSource.instances) {
        if (inst.readyState === 1) inst.emit(type, data, id);
      }
    };
    w.__reactorSseError = () => {
      for (const inst of [...MockEventSource.instances]) inst.onerror?.(new Event("error"));
    };
    w.__reactorSseSetHelloHead = (n) => {
      MockEventSource.helloHead = n;
    };
  });
}

async function waitStream(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const ES = window.EventSource as unknown as { instances?: unknown[] };
    return Array.isArray(ES.instances) && ES.instances.length > 0;
  });
}

async function emit(page: import("@playwright/test").Page, type: string, data: unknown, id?: number) {
  await waitStream(page);
  await page.evaluate(
    ([t, d, n]) => {
      (window as unknown as { __reactorSseEmit: (type: string, data: unknown, id?: number) => void }).__reactorSseEmit(
        t as string,
        d,
        n as number | undefined,
      );
    },
    [type, data, id] as const,
  );
}

test("bottom-right toasts only confirmed live CORE and Top-10 buy+burn", async ({ page }) => {
  await installMockStream(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await expect(page.getByTestId("live-toast")).toHaveCount(0);

  await emit(page, "core", { ...ident("BuybackExecuted", CORE_TX, 1) }, 80);
  await expect(page.getByTestId("live-toast")).toHaveCount(0);

  await emit(page, "core", { ...ident("BuybackExecuted", CORE_TX, 1), quoteIn: "2500000", coreOut: "1000000000000000000" }, 101);
  const coreToast = page.getByTestId("live-toast").filter({ hasText: /CORE buy\+burn confirmed/i });
  await expect(coreToast).toBeVisible();
  await expect(coreToast).toHaveAttribute("data-kind", "core");
  await expect(coreToast.getByRole("link", { name: /View tx/i })).toHaveAttribute("href", new RegExp(CORE_TX, "i"));

  await emit(page, "core", { ...ident("COREBurned", CORE_TX, 2), coreOut: "1000000000000000000" }, 102);
  await expect(page.getByTestId("live-toast").filter({ hasText: /CORE buy\+burn confirmed/i })).toHaveCount(2);

  await emit(page, "burn", { ...ident("Top10Buy", TOP_TX, 3), token: TOKEN, amount: "4000000", burned: "2000000000000000000" }, 103);
  await expect(page.getByTestId("live-toast")).toHaveCount(3);
  await expect(page.getByTestId("live-toast").filter({ hasText: /Top-10 buy\+burn confirmed/i })).toBeVisible();

  await emit(page, "burn", { ...ident("SelfBurnExecuted", `0x${"ee".repeat(32)}`, 4) }, 104);
  await emit(page, "top10", { epochId: "9", pot: "1" }, 105);
  await emit(page, "trade", { tx: TOP_TX }, 106);
  await expect(page.getByTestId("live-toast")).toHaveCount(3);

  const stack = page.getByTestId("live-toast-stack");
  await expect(stack).toHaveAttribute("data-safe-area", "1");
  expect(await stack.evaluate((el) => (el as HTMLElement).style.bottom)).toContain("safe-area-inset-bottom");
  expect(await stack.evaluate((el) => (el as HTMLElement).style.right)).toContain("safe-area-inset-right");
  const box = await stack.boundingBox();
  const vp = page.viewportSize();
  expect(box && vp && box.x + box.width > vp.width * 0.6 && box.y + box.height > vp.height * 0.7).toBeTruthy();

  await page.getByRole("navigation").getByRole("link", { name: /^THE REACTOR$/ }).click();
  await expect(page.getByRole("heading", { name: /Top-10 flywheel/i })).toBeVisible();
  await expect(page.getByTestId("live-toast")).toHaveCount(3);
});

test("same-tx distinct-log Top10Buy stay two toasts; duplicate after dismiss does not return", async ({ page }) => {
  await installMockStream(page);
  await page.goto("/?toastMs=400");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();

  await emit(page, "burn", { ...ident("Top10Buy", TOP_TX, 10), token: TOKEN, amount: "1", burned: "1" }, 101);
  await emit(page, "burn", { ...ident("Top10Buy", TOP_TX, 11), token: TOKEN, amount: "2", burned: "2" }, 102);
  await expect(page.getByTestId("live-toast")).toHaveCount(2);
  await expect(page.getByTestId("live-toast").nth(0)).toHaveAttribute("data-identity", `${CHAIN}:${TOP_TX}:10:Top10Buy`);
  await expect(page.getByTestId("live-toast").nth(1)).toHaveAttribute("data-identity", `${CHAIN}:${TOP_TX}:11:Top10Buy`);

  await expect(page.getByTestId("live-toast")).toHaveCount(0, { timeout: 3_000 });
  await emit(page, "burn", { ...ident("Top10Buy", TOP_TX, 10), token: TOKEN, amount: "1", burned: "1" }, 110);
  await page.waitForTimeout(200);
  await expect(page.getByTestId("live-toast")).toHaveCount(0);
});

test("disconnect then reconnect delivers missed live events once and does not dump history", async ({ page }) => {
  await installMockStream(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();

  await emit(page, "core", { ...ident("BuybackExecuted", CORE_TX, 1), quoteIn: "2500000", coreOut: "1" }, 101);
  await expect(page.getByTestId("live-toast")).toHaveCount(1);

  await page.evaluate(() => {
    (window as unknown as { __reactorSseSetHelloHead: (n: number) => void }).__reactorSseSetHelloHead(200);
    (window as unknown as { __reactorSseError: () => void }).__reactorSseError();
  });
  await page.waitForFunction(() => String((window as unknown as { __reactorLastStreamUrl?: string }).__reactorLastStreamUrl ?? "").includes("after=101"));

  await emit(page, "core", { ...ident("BuybackExecuted", `0x${"99".repeat(32)}`, 9), quoteIn: "1", coreOut: "1" }, 50);
  await expect(page.getByTestId("live-toast")).toHaveCount(1);

  await emit(page, "core", { ...ident("BuybackExecuted", CORE_TX, 1), quoteIn: "2500000", coreOut: "1" }, 101);
  await expect(page.getByTestId("live-toast")).toHaveCount(1);

  const missedTx = `0x${"77".repeat(32)}`;
  await emit(page, "burn", { ...ident("Top10Buy", missedTx, 8), token: TOKEN, amount: "4", burned: "4" }, 150);
  await expect(page.getByTestId("live-toast").filter({ hasText: /Top-10 buy\+burn confirmed/i })).toHaveCount(1);
  await emit(page, "burn", { ...ident("Top10Buy", missedTx, 8), token: TOKEN, amount: "4", burned: "4" }, 150);
  await expect(page.getByTestId("live-toast").filter({ hasText: /Top-10 buy\+burn confirmed/i })).toHaveCount(1);
});

test("hover and focus pause auto-dismiss", async ({ page }) => {
  await installMockStream(page);
  await page.goto("/?toastMs=400");
  await expect(page.getByRole("heading", { name: /Choose what your token earns/i })).toBeVisible();
  await emit(page, "core", { ...ident("BuybackExecuted", CORE_TX, 1), quoteIn: "2500000", coreOut: "1" }, 101);
  const stack = page.getByTestId("live-toast-stack");
  await expect(stack).toBeVisible();
  await stack.hover();
  await expect(stack).toHaveAttribute("data-paused", "1");
  await page.waitForTimeout(700);
  await expect(page.getByTestId("live-toast")).toHaveCount(1);
  await page.getByRole("link", { name: /View tx/i }).focus();
  await expect(stack).toHaveAttribute("data-paused", "1");
  await page.mouse.move(0, 0);
  await page.getByRole("heading", { name: /Choose what your token earns/i }).click();
  await expect(stack).toHaveAttribute("data-paused", "0");
  await expect(page.getByTestId("live-toast")).toHaveCount(0, { timeout: 3_000 });
});

test("review fixture demoToast seeds confirmed CORE and Top-10 notices", async ({ page }) => {
  await page.goto("/?demoToast=both");
  await expect(page.getByTestId("live-toast")).toHaveCount(2);
  await expect(page.getByTestId("live-toast").filter({ hasText: /CORE buy\+burn confirmed/i })).toBeVisible();
  await expect(page.getByTestId("live-toast").filter({ hasText: /Top-10 buy\+burn confirmed/i })).toBeVisible();
});

test("live toasts sit bottom-right on mobile 390 with safe-area insets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockStream(page);
  await page.goto("/core");
  await expect(page.getByRole("heading", { name: /^CORE$/ })).toBeVisible();
  await emit(page, "core", { ...ident("COREBurned", CORE_TX, 2), coreOut: "500000000000000000" }, 110);
  const stack = page.getByTestId("live-toast-stack");
  await expect(stack).toBeVisible();
  expect(await stack.evaluate((el) => (el as HTMLElement).style.bottom)).toContain("safe-area-inset-bottom");
  const box = await stack.boundingBox();
  expect(box).toBeTruthy();
  if (box) {
    expect(box.x).toBeGreaterThan(390 - box.width - 32);
    expect(box.y).toBeGreaterThan(844 - box.height - 40);
  }
});

test("reduced-motion skips toast animation class", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockStream(page);
  await page.goto("/");
  await emit(page, "core", { ...ident("BuybackExecuted", CORE_TX, 1), quoteIn: "1", coreOut: "1" }, 101);
  const stack = page.getByTestId("live-toast-stack");
  await expect(stack).toBeVisible();
  await expect(stack).toHaveAttribute("data-reduced-motion", "1");
  await expect(stack).not.toHaveClass(/live-toast-motion/);
});
