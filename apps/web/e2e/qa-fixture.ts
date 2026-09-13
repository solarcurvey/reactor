import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  allowsForInjects,
  diagnosticPayload,
  parseInjectFromUrl,
  unexpectedDiagnostics,
  type PageDiagnostic,
} from "./console-gate";

export type DiagnosticAllow = RegExp | ((d: PageDiagnostic) => boolean);

export type ConsoleGate = {
  records: PageDiagnostic[];
  injects: Set<string>;
  extraAllows: DiagnosticAllow[];
  allow(pattern: DiagnosticAllow): void;
};

function install(page: Page): ConsoleGate {
  const records: PageDiagnostic[] = [];
  const injects = new Set<string>();
  const extraAllows: DiagnosticAllow[] = [];

  const noteUrl = (url: string) => {
    const kind = parseInjectFromUrl(url);
    if (kind) injects.add(kind);
  };

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) noteUrl(frame.url());
  });

  page.on("console", (msg) => {
    const loc = msg.location();
    records.push({
      source: "console",
      type: msg.type(),
      text: msg.text(),
      location: loc.url ? `${loc.url}:${loc.lineNumber ?? 0}:${loc.columnNumber ?? 0}` : undefined,
    });
  });

  page.on("pageerror", (err) => {
    records.push({
      source: "pageerror",
      type: "exception",
      text: err.stack || err.message,
    });
  });

  return {
    records,
    injects,
    extraAllows,
    allow(pattern: RegExp) {
      extraAllows.push(pattern);
    },
  };
}

export const test = base.extend<{ consoleGate: ConsoleGate }>({
  consoleGate: [
    async ({ page }, use, testInfo) => {
      const gate = install(page);
      noteCurrent(page, gate);
      await use(gate);
      noteCurrent(page, gate);
      const regexAllows = gate.extraAllows.filter((a): a is RegExp => a instanceof RegExp);
      const predAllows = gate.extraAllows.filter((a): a is (d: PageDiagnostic) => boolean => typeof a === "function");
      const allows = [...allowsForInjects(gate.injects), ...regexAllows];
      const unexpected = unexpectedDiagnostics(gate.records, allows).filter(
        (d) => !predAllows.some((fn) => fn(d)),
      );
      const payload = diagnosticPayload(gate.records, unexpected);
      if (unexpected.length > 0 || testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("page-diagnostics.json", {
          body: Buffer.from(JSON.stringify(payload, null, 2)),
          contentType: "application/json",
        });
        await testInfo.attach("page-diagnostics.txt", {
          body: Buffer.from(payload.summary),
          contentType: "text/plain",
        });
      }
      if (unexpected.length > 0) {
        testInfo.annotations.push({ type: "page-diagnostics", description: payload.summary });
        expect(unexpected, payload.summary).toEqual([]);
      }
    },
    { auto: true },
  ],
});

function noteCurrent(page: Page, gate: ConsoleGate) {
  try {
    const kind = parseInjectFromUrl(page.url());
    if (kind) gate.injects.add(kind);
  } catch {
    /* page may not have a url yet */
  }
}

export { expect };
