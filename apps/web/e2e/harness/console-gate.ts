import type { ConsoleMessage, Page, TestInfo } from "@playwright/test";

export type ConsoleGateFinding = {
  kind: "console" | "pageerror";
  text: string;
};

export type ConsoleGate = {
  findings: ConsoleGateFinding[];
  assertClean: (testInfo?: TestInfo, page?: Page) => Promise<void>;
};

/**
 * Narrow allowlist for the production UI release gate.
 *
 * Playwright does not fail on `console.error` or `pageerror` by default.
 * This fixture records both and fails teardown unless a finding matches
 * an entry below.
 *
 * Only add an entry after a production-build run proves the message is
 * harness- or browser-noise — never a product bug. Each entry must name
 * the surface and why it is expected.
 *
 * Not expected (must still fail the suite):
 * - Wallet reject (EIP-1193 4001) and wrong-chain are UI copy; they must
 *   not leak as console.error / unhandled pageerror.
 * - The mock indexer serves `/stream` as a keep-alive SSE hello so the
 *   live-toast EventSource is not a 404.
 */
const EXPECTED: ReadonlyArray<{
  kind: "console" | "pageerror";
  pattern: RegExp;
  reason: string;
}> = [
  // edge.spec "Dev Buy fails closed when authorization is down":
  // mock `/launch/authorize` returns 503; the Next BFF proxies that as
  // HTTP 503 on `/api/launch-pricing`. Chromium logs failed HTTP as
  // console.error. The ticket must fail closed — this is not an unhandled
  // exception or a product defect.
  {
    kind: "console",
    pattern:
      /Failed to load resource: the server responded with a status of 503 \(Service Unavailable\) \(https?:\/\/127\.0\.0\.1:43147\/api\/launch-pricing\)/,
    reason: "Dev Buy authorize-down journey: expected BFF 503, fail-closed UI",
  },
  // Next App Router Link prefetch of RSC payloads can fail and Next falls
  // back to full navigation. Home has many token/quote/fair links.
  // WebKit suffix is `TypeError: Load failed`; Firefox serializes the
  // cause as `JSHandle@object`. Journeys still resolve; not a product defect.
  {
    kind: "console",
    pattern:
      /Failed to fetch RSC payload for https?:\/\/127\.0\.0\.1:43147\/\S+ Falling back to browser navigation/,
    reason: "Next.js RSC prefetch abort/fallback (WebKit + Firefox home page)",
  },
  // Companion pageerror from the same WebKit prefetch: fetch of `?_rsc=`
  // is reported as an access-control failure, then Next navigates fully.
  {
    kind: "pageerror",
    pattern: /(?:Fetch API cannot load https?:\/\/)?127\.0\.0\.1:43147\/\S+\?_rsc=\S+ due to access control checks/,
    reason: "iPhone WebKit: Next.js ?_rsc= prefetch access-control, then fallback",
  },
  // Same WebKit access-control report for the #50 indexed client fetch to the
  // local mock (`connect-src` + CORS `*` are set; navigation still succeeds).
  // WebKit sometimes omits the "Fetch API cannot load https://" prefix and
  // reports `/127.0.0.1:18448/stream due to access control checks.`
  {
    kind: "pageerror",
    pattern: /(?:Fetch API cannot load https?:\/\/)?127\.0\.0\.1:18448\/\S+ due to access control checks/,
    reason: "WebKit: mock indexer :18448 fetch access-control, then fixture/fallback",
  },
];

function isExpected(kind: ConsoleGateFinding["kind"], text: string): boolean {
  return EXPECTED.some((entry) => entry.kind === kind && entry.pattern.test(text));
}

function consoleText(msg: ConsoleMessage): string {
  const loc = msg.location();
  const where = loc?.url ? ` (${loc.url}${loc.lineNumber ? `:${loc.lineNumber}` : ""})` : "";
  return `${msg.text()}${where}`;
}

function formatFindings(findings: ConsoleGateFinding[]): string {
  return [
    "Release gate: unexpected browser console.error / pageerror",
    ...findings.map((finding, index) => `  ${index + 1}. [${finding.kind}] ${finding.text}`),
  ].join("\n");
}

/** Attach error-level console + pageerror listeners. Call `assertClean` in fixture teardown. */
export function attachConsoleGate(page: Page): ConsoleGate {
  const findings: ConsoleGateFinding[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = consoleText(msg);
    if (isExpected("console", text)) return;
    findings.push({ kind: "console", text });
  });

  page.on("pageerror", (err) => {
    const text = err.stack || err.message || String(err);
    if (isExpected("pageerror", text)) return;
    findings.push({ kind: "pageerror", text });
  });

  return {
    findings,
    async assertClean(testInfo, pageForShot) {
      if (findings.length === 0) return;
      const report = formatFindings(findings);
      if (testInfo) {
        await testInfo.attach("console-gate", { body: report, contentType: "text/plain" });
        if (pageForShot && !pageForShot.isClosed()) {
          try {
            const shot = await pageForShot.screenshot({ fullPage: true });
            await testInfo.attach("console-gate.png", { body: shot, contentType: "image/png" });
          } catch {
            /* page may already be tearing down; Playwright still retains traces */
          }
        }
      }
      throw new Error(report);
    },
  };
}
