import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  contentSecurityPolicy,
  httpsEnforced,
  launchpadSecurityHeaders,
  scriptSrcDirective,
} from "./security-headers.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const dev = contentSecurityPolicy({ production: false });
assert(dev.includes("default-src 'self'"), "default-src");
assert(dev.includes("frame-ancestors 'none'"), "frame-ancestors");
assert(dev.includes("object-src 'none'"), "object-src");
assert(dev.includes("base-uri 'self'"), "base-uri");
assert(dev.includes("form-action 'self'"), "form-action");
assert(dev.includes("script-src"), "script-src");
assert(dev.includes("https://challenges.cloudflare.com"), "turnstile");
assert(dev.includes("img-src 'self'"), "img-src self");
assert(!/img-src[^;]*https:/.test(dev.replace(/https:\/\/[a-z0-9.:-]+/gi, "")), "img-src is not a bare https: wildcard");
assert(dev.includes("unsafe-eval"), "dev CSP allows eval for HMR");
assert(dev.includes("style-src 'self' 'unsafe-inline'"), "style-src residual unsafe-inline");
assert(!httpsEnforced(), "tests are not REACTOR_ENV=PROD");
assert(!dev.includes("upgrade-insecure-requests"), "no upgrade on local");

const prodScript = scriptSrcDirective({ nonce: "testnonce", production: true });
assert(prodScript.includes("'nonce-testnonce'"), "prod script nonce");
assert(prodScript.includes("'strict-dynamic'"), "prod strict-dynamic");
assert(!prodScript.includes("unsafe-inline"), "prod script-src has no unsafe-inline");
assert(!prodScript.includes("unsafe-eval"), "prod script-src has no unsafe-eval");
assert(scriptSrcDirective({ production: true }) === "script-src 'none'", "prod without nonce fail-closes");

const prod = contentSecurityPolicy({ nonce: "testnonce", production: true });
assert(!/script-src[^;]*unsafe-inline/.test(prod), "prod CSP script-src omits unsafe-inline");
assert(prod.includes("style-src 'self' 'unsafe-inline'"), "style residual documented in header");
assert(prod.includes("'nonce-testnonce'"), "prod CSP carries nonce");

const headers = launchpadSecurityHeaders();
const map = Object.fromEntries(headers.map((h) => [h.key, h.value]));
assert(!map["Content-Security-Policy"], "static headers omit CSP (middleware sets nonce)");
assert(map["X-Content-Type-Options"] === "nosniff", "nosniff");
assert(map["X-Frame-Options"] === "DENY", "deny frame");
assert(map["Referrer-Policy"] === "no-referrer", "no referrer");
assert(map["Cross-Origin-Opener-Policy"] === "same-origin", "coop");
assert(!map["Strict-Transport-Security"], "no HSTS outside PROD");

const cfg = readFileSync(join(import.meta.dirname, "../../next.config.ts"), "utf8");
assert(cfg.includes("launchpadSecurityHeaders"), "next.config uses shared static headers");
assert(!/Content-Security-Policy/.test(cfg), "next.config does not emit a second CSP");

const mw = readFileSync(join(import.meta.dirname, "../middleware.ts"), "utf8");
assert(mw.includes("x-nonce"), "middleware stamps x-nonce");
assert(mw.includes("contentSecurityPolicy"), "middleware builds CSP");
assert(mw.includes("strict-dynamic") || mw.includes("production"), "middleware production nonce path");

const indexer = readFileSync(join(import.meta.dirname, "../../../indexer/src/index.ts"), "utf8");
assert(indexer.includes('Content-Security-Policy", "default-src \'none\'; sandbox"'), "media GET is sandboxed");
assert(indexer.includes("X-Content-Type-Options"), "media nosniff");

console.log("security-headers tests ok");
