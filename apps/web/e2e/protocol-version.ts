import { loadProtocolVersion } from "../src/lib/docs";

/**
 * CJS-safe (Playwright compiles e2e specs without ESM `import.meta`).
 * Reads `docs/version.json` via cwd fallbacks — do not use `import.meta.url` here.
 */
export const PROTOCOL_VERSION = loadProtocolVersion().protocolVersion;

export const RELEASE_PREFIX = new RegExp(`^reactor@${PROTOCOL_VERSION.replace(/\./g, "\\.")}\\+`);
