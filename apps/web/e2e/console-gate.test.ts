import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowsForInjects,
  formatDiagnosticReport,
  INJECT_CONSOLE_ALLOWS,
  isAllowedDiagnostic,
  isBestEffortTelemetryBackpressure,
  isBlockingDiagnostic,
  isHydrationWarning,
  parseInjectFromUrl,
  unexpectedDiagnostics,
  type PageDiagnostic,
} from "./console-gate.ts";
import { QA_INJECT_KINDS } from "../src/lib/qa-inject.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function diag(partial: Partial<PageDiagnostic> & Pick<PageDiagnostic, "text">): PageDiagnostic {
  return { source: "console", type: "error", ...partial };
}

assert(isHydrationWarning("Warning: Text content did not match. Server: \"A\" Client: \"B\""), "server mismatch");
assert(isHydrationWarning("Hydration failed because the initial UI does not match"), "hydration failed");
assert(isHydrationWarning("A tree hydrated but some attributes of the server rendered HTML"), "tree hydrated");
assert(isHydrationWarning("Expected server HTML to contain a matching <div>"), "expected server html");
assert(!isHydrationWarning("Failed to fetch indexer /health"), "fetch is not hydration");

assert(isBlockingDiagnostic(diag({ type: "error", text: "boom" })), "console.error blocks");
assert(isBlockingDiagnostic(diag({ type: "assert", text: "assert fail" })), "console.assert blocks");
assert(isBlockingDiagnostic({ source: "pageerror", type: "exception", text: "TypeError: x" }), "pageerror blocks");
assert(
  isBlockingDiagnostic(diag({ type: "warning", text: "Warning: Text content did not match. Server: \"1\"" })),
  "hydration warning blocks",
);
assert(!isBlockingDiagnostic(diag({ type: "warning", text: "Download the React DevTools" })), "plain warning ok");
assert(!isBlockingDiagnostic(diag({ type: "log", text: "ok" })), "log ok");

assert(parseInjectFromUrl("http://127.0.0.1:43147/?inject=indexer") === "indexer", "inject from url");
assert(parseInjectFromUrl("http://127.0.0.1:43147/core?inject=rpc") === "rpc", "rpc inject");
assert(parseInjectFromUrl("http://127.0.0.1:43147/?state=toast") === null, "state is not inject");
assert(parseInjectFromUrl("http://127.0.0.1:43147/?inject=oracle") === null, "unknown inject");

for (const kind of QA_INJECT_KINDS) {
  assert(Array.isArray(INJECT_CONSOLE_ALLOWS[kind]), `allowlist row for ${kind}`);
}

assert(INJECT_CONSOLE_ALLOWS.empty.length === 0, "empty markets are not an outage — no console allow");
assert(allowsForInjects(["empty"]).length === 0, "empty inject adds no allows");

const indexerAllows = allowsForInjects(["indexer"]);
assert(
  isAllowedDiagnostic(diag({ text: "ServiceUnavailableError: Market board, charts, and tape come from the indexer." }), indexerAllows),
  "indexer ServiceUnavailableError allowed",
);
assert(
  !isAllowedDiagnostic(diag({ text: "TypeError: Cannot read properties of null" }), indexerAllows),
  "unrelated error not allowed on indexer inject",
);
assert(
  !isAllowedDiagnostic(diag({ type: "warning", text: "Hydration failed because the initial UI does not match" }), indexerAllows),
  "hydration never allowlisted",
);

const unexpected = unexpectedDiagnostics(
  [
    diag({ text: "ServiceUnavailableError: Indexer unavailable" }),
    diag({ text: "Failed to load resource: net::ERR_FAILED" }),
    { source: "pageerror", type: "exception", text: "ReferenceError: foo is not defined" },
    diag({ type: "warning", text: "Hydration failed because the initial UI does not match" }),
    diag({ type: "info", text: "hello" }),
  ],
  indexerAllows,
);
assert(unexpected.length === 3, `unexpected count ${unexpected.length}`);
assert(unexpected.some((d) => d.text.includes("ERR_FAILED")), "generic fetch failure is unexpected");
assert(
  unexpectedDiagnostics(
    [diag({ text: "Failed to load resource: net::ERR_CONNECTION_REFUSED", location: "http://127.0.0.1:18545/:0:0" })],
    allowsForInjects(["rpc"]),
  ).length === 1,
  "RPC connection refused is not an inject allow — the QA harness must serve qa-rpc.mjs",
);
assert(unexpected.some((d) => d.source === "pageerror"), "pageerror unexpected");
assert(unexpected.some((d) => /hydrat/i.test(d.text)), "hydration unexpected");

const report = formatDiagnosticReport(
  [diag({ text: "Failed to load resource: net::ERR_FAILED" })],
  [diag({ text: "Failed to load resource: net::ERR_FAILED" })],
);
assert(report.includes("Unexpected page diagnostics (1)"), "summary count");
assert(report.includes("[console:error] Failed to load resource"), "formatted row");

const telemetry429 = diag({
  text: "Failed to load resource: the server responded with a status of 429 (Too Many Requests)",
  location: "http://127.0.0.1:43147/api/telemetry:0:0",
});
assert(isBestEffortTelemetryBackpressure(telemetry429), "telemetry 429 is ingest backpressure");
assert(!isBlockingDiagnostic(telemetry429), "telemetry 429 is not a page diagnostic");
assert(
  unexpectedDiagnostics([telemetry429], []).length === 0,
  "telemetry ingest 429 is never unexpected",
);
assert(
  isBlockingDiagnostic(
    diag({
      text: "Failed to load resource: the server responded with a status of 429 (Too Many Requests)",
      location: "http://127.0.0.1:43147/api/quote:0:0",
    }),
  ),
  "quote 429 still blocks without an inject allow",
);
assert(
  !isBestEffortTelemetryBackpressure(diag({ text: "Failed to load resource: 429", location: "http://127.0.0.1:43147/quote:0:0" })),
  "non-telemetry 429 is not ingest backpressure",
);

function* specFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "extension") continue;
      yield* specFiles(p);
    } else if (name.endsWith(".spec.ts")) {
      yield p;
    }
  }
}

const e2eDir = dirname(fileURLToPath(import.meta.url));
for (const p of specFiles(e2eDir)) {
  const src = readFileSync(p, "utf8");
  assert(
    !/\bimport\.meta\b/.test(src),
    `${p} must stay CJS-safe for Playwright (no import.meta; apps/web is not "type":"module")`,
  );
}

console.log("console-gate ok");
