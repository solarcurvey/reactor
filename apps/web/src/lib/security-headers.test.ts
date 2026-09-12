import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentSecurityPolicy, httpsEnforced, launchpadSecurityHeaders } from "./security-headers.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const csp = contentSecurityPolicy();
assert(csp.includes("default-src 'self'"), "default-src");
assert(csp.includes("frame-ancestors 'none'"), "frame-ancestors");
assert(csp.includes("object-src 'none'"), "object-src");
assert(csp.includes("base-uri 'self'"), "base-uri");
assert(csp.includes("form-action 'self'"), "form-action");
assert(csp.includes("script-src"), "script-src");
assert(csp.includes("https://challenges.cloudflare.com"), "turnstile");
assert(csp.includes("img-src 'self'"), "img-src self");
assert(!/img-src[^;]*https:/.test(csp.replace(/https:\/\/[a-z0-9.:-]+/gi, "")), "img-src is not a bare https: wildcard");
assert(!csp.includes("unsafe-eval") || process.env.NODE_ENV !== "production", "prod CSP avoids eval unless dev");
assert(!httpsEnforced(), "tests are not REACTOR_ENV=PROD");
assert(!csp.includes("upgrade-insecure-requests"), "no upgrade on local");

const headers = launchpadSecurityHeaders();
const map = Object.fromEntries(headers.map((h) => [h.key, h.value]));
assert(map["Content-Security-Policy"] === csp, "header matches builder");
assert(map["X-Content-Type-Options"] === "nosniff", "nosniff");
assert(map["X-Frame-Options"] === "DENY", "deny frame");
assert(map["Referrer-Policy"] === "no-referrer", "no referrer");
assert(map["Cross-Origin-Opener-Policy"] === "same-origin", "coop");
assert(!map["Strict-Transport-Security"], "no HSTS outside PROD");

const cfg = readFileSync(join(import.meta.dirname, "../../next.config.ts"), "utf8");
assert(cfg.includes("launchpadSecurityHeaders"), "next.config uses shared headers");

const indexer = readFileSync(join(import.meta.dirname, "../../../indexer/src/index.ts"), "utf8");
assert(indexer.includes('Content-Security-Policy", "default-src \'none\'; sandbox"'), "media GET is sandboxed");
assert(indexer.includes("X-Content-Type-Options"), "media nosniff");

console.log("security-headers tests ok");
