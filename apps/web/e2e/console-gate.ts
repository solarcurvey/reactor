import { parseQaInject, type QaInjectKind } from "../src/lib/qa-inject";

export type DiagnosticSource = "console" | "pageerror";

export type PageDiagnostic = {
  source: DiagnosticSource;
  /** Playwright console type, or `exception` for pageerror. */
  type: string;
  text: string;
  location?: string;
};

/**
 * Narrow allowlists for intentional `?inject=` paths only.
 * Hydration warnings and uncaught page exceptions are never allowlisted here.
 * Patterns must match the injected failure — not a generic `Failed to fetch`.
 */
export const INJECT_CONSOLE_ALLOWS: Record<QaInjectKind, readonly RegExp[]> = {
  indexer: [/ServiceUnavailableError/, /Indexer unavailable/, /GET \/health/],
  rpc: [/ServiceUnavailableError/, /RPC unavailable/, /Could not read the chain/, /5042002/],
  quote: [/ServiceUnavailableError/, /Quote unavailable/, /POST \/quote failed/],
  "quote-429": [/ServiceUnavailableError/, /Quote rate-limited/, /returned 429/],
  "quote-413": [/ServiceUnavailableError/, /Quote body rejected/, /returned 413/, /16KiB/],
  "quote-5xx": [/ServiceUnavailableError/, /Quote service error/, /returned 5xx/],
  "quote-stale": [/ServiceUnavailableError/, /Quote stale/, /older than 30s/],
  "quote-expired": [/ServiceUnavailableError/, /Quote expired/, /ticket expired/],
  "quote-noroute": [/ServiceUnavailableError/, /No route/, /no official path/],
  pricing: [/ServiceUnavailableError/, /SIGNER_STORE_UNAVAILABLE/, /Launch pricing/],
  upload: [/ServiceUnavailableError/, /No StoredMedia/, /upload failed/],
  sse: [/ServiceUnavailableError/, /Live feed disconnected/, /duplicate toast/],
  empty: [],
  "token-invalid": [/not a factory launch/i],
  "ticker-invalid": [/normalize \/ reserve/, /Invalid ticker/],
  "wallet-reject": [/4001/, /Wallet rejected/],
  "wallet-revert": [/transaction reverted/i, /Incomplete fills revert/],
};

const HYDRATION_RE =
  /hydrat(?:e|ion|ing)|did not match(?:\.| the)?(?: server)?|expected server html|text content does not match|a tree hydrated|server rendered (?:html|text)|didn't match the client/i;

export function isHydrationWarning(text: string): boolean {
  return HYDRATION_RE.test(text);
}

export function parseInjectFromUrl(url: string): QaInjectKind | null {
  try {
    return parseQaInject(new URL(url, "http://qa.local").search);
  } catch {
    return parseQaInject(url);
  }
}

export function allowsForInjects(kinds: Iterable<string>): RegExp[] {
  const out: RegExp[] = [];
  for (const kind of kinds) {
    const rows = INJECT_CONSOLE_ALLOWS[kind as QaInjectKind];
    if (rows) out.push(...rows);
  }
  return out;
}

export function isBlockingDiagnostic(d: PageDiagnostic): boolean {
  if (d.source === "pageerror") return true;
  if (d.type === "error" || d.type === "assert") return true;
  if (isHydrationWarning(d.text)) return true;
  return false;
}

export function isAllowedDiagnostic(d: PageDiagnostic, allows: readonly RegExp[]): boolean {
  if (isHydrationWarning(d.text)) return false;
  return allows.some((re) => re.test(d.text));
}

export function unexpectedDiagnostics(records: readonly PageDiagnostic[], allows: readonly RegExp[]): PageDiagnostic[] {
  return records.filter((d) => isBlockingDiagnostic(d) && !isAllowedDiagnostic(d, allows));
}

export function formatDiagnosticReport(records: readonly PageDiagnostic[], unexpected: readonly PageDiagnostic[]): string {
  const lines = [
    `Unexpected page diagnostics (${unexpected.length}):`,
    ...unexpected.map((d) => `  [${d.source}:${d.type}] ${d.text}${d.location ? ` (${d.location})` : ""}`),
    `Collected ${records.length} message(s); ${records.filter(isBlockingDiagnostic).length} blocking.`,
  ];
  return lines.join("\n");
}

export function diagnosticPayload(records: readonly PageDiagnostic[], unexpected: readonly PageDiagnostic[]) {
  return {
    unexpected,
    records,
    summary: formatDiagnosticReport(records, unexpected),
  };
}
