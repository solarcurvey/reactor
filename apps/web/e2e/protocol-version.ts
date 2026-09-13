import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CJS-safe (Playwright compiles e2e specs without ESM `import.meta`).
 * Reads `docs/version.json` via cwd fallbacks — do not use `import.meta.url` here.
 */
function repoRoot(): string {
  const candidates = [process.cwd(), join(process.cwd(), ".."), join(process.cwd(), "..", "..")];
  for (const c of candidates) {
    if (existsSync(join(c, "docs", "version.json"))) return c;
  }
  return candidates[0]!;
}

export const PROTOCOL_VERSION = (
  JSON.parse(readFileSync(join(repoRoot(), "docs", "version.json"), "utf8")) as {
    protocolVersion: string;
  }
).protocolVersion;

export const RELEASE_PREFIX = new RegExp(`^reactor@${PROTOCOL_VERSION.replace(/\./g, "\\.")}\\+`);
