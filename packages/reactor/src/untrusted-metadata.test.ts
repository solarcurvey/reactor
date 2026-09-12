import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  containsHtmlTag,
  fairPath,
  hasDangerousScheme,
  launchPath,
  quotePath,
  sanitizeAddress,
  sanitizeDescription,
  sanitizeDocHref,
  sanitizeDisplayText,
  sanitizeExternalUrl,
  sanitizeLaunchFields,
  sanitizeMediaUrl,
  sanitizeTelegramUrl,
  sanitizeTicker,
  sanitizeTokenName,
  sanitizeTwitterUrl,
  sanitizeWebsiteUrl,
  tokenPath,
  untrustedMetadataReasons,
} from "./untrusted-metadata.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

{
  assert(sanitizeTokenName('<script>alert(1)</script>Safe') === "alert(1)Safe", "strip script tags from name");
  assert(sanitizeTokenName('<img src=x onerror=alert(1)>') === "Token", "empty after tag strip → Token");
  assert(!sanitizeTokenName('<b>Bold</b>Cat').includes("<"), "no leftover markup in name");
  assert(sanitizeTokenName("A".repeat(200)).length === 64, "name length cap");
  assert(sanitizeTokenName("Cat\u0000\u0007") === "Cat", "strip C0 from name");
  assert(sanitizeTokenName("C\u202Eat") === "Cat", "strip bidi override");
  assert(sanitizeDescription("hello <iframe src=javascript:alert(1)>") === "hello", "strip iframe from description");
  assert(sanitizeDescription("buy\n\nnow").includes("buy"), "description keeps words");
  assert(sanitizeTicker("cat<script>") === "CAT", "ticker alnum only");
  assert(sanitizeTicker("../../../etc") === "ETC", "ticker cannot path-travel as href");
  assert(sanitizeDisplayText("  lots   of\tspace ", 32) === "lots of space", "collapse whitespace");
}

{
  const bad = [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://evil.example/1",
    "about:blank",
    "//evil.example/phish",
    "https://user:pass@evil.example/",
    "https://evil.example/<script>",
    "http://evil.example/not-local",
  ];
  for (const u of bad) {
    assert(sanitizeWebsiteUrl(u) === "", `reject website ${JSON.stringify(u)}`);
    assert(sanitizeExternalUrl(u) == null, `reject external ${JSON.stringify(u)}`);
  }
  assert(hasDangerousScheme("java\nscript:alert(1)"), "folded javascript");
  assert(containsHtmlTag("<script>"), "html tag detect");
  assert(sanitizeWebsiteUrl("https://example.com/x") === "https://example.com/x", "https website ok");
  assert(sanitizeWebsiteUrl("https://reactor.local/docs").startsWith("https://reactor.local/"), "https local-looking host ok");
  assert(sanitizeWebsiteUrl("http://127.0.0.1:43147/docs").includes("127.0.0.1"), "loopback http ok");
  assert(sanitizeWebsiteUrl("") === "", "empty website");
}

{
  assert(sanitizeTwitterUrl("https://x.com/reactor") === "https://x.com/reactor", "x.com");
  assert(sanitizeTwitterUrl("https://twitter.com/reactor").includes("twitter.com"), "twitter.com");
  assert(sanitizeTwitterUrl("@hello_world") === "https://x.com/hello_world", "handle");
  assert(sanitizeTwitterUrl("https://evil.example/reactor") === "", "twitter host allowlist");
  assert(sanitizeTwitterUrl("javascript:alert(1)") === "", "twitter js");
  assert(sanitizeTelegramUrl("https://t.me/reactor") === "https://t.me/reactor", "t.me");
  assert(sanitizeTelegramUrl("@chan") === "https://t.me/chan", "tg handle");
  assert(sanitizeTelegramUrl("https://evil.example/chan") === "", "telegram host allowlist");
}

{
  assert(sanitizeMediaUrl("/m/0123456789abcdef0123.webp") === "/m/0123456789abcdef0123.webp", "relative media");
  assert(sanitizeMediaUrl("/icons/zec.svg") === "/icons/zec.svg", "first-party icon");
  assert(sanitizeMediaUrl("/icons/usdc.svg") === "/icons/usdc.svg", "usdc icon");
  assert(sanitizeMediaUrl("http://127.0.0.1:43148/m/0123456789abcdef0123.webp") === "http://127.0.0.1:43148/m/0123456789abcdef0123.webp", "indexer media");
  assert(sanitizeMediaUrl("https://evil.example/m/0123456789abcdef0123.webp") === "", "foreign origin media");
  assert(sanitizeMediaUrl("https://evil.example/logo.png") === "", "arbitrary https image");
  assert(sanitizeMediaUrl("javascript:alert(1)") === "", "js image");
  assert(sanitizeMediaUrl("data:image/svg+xml,<svg onload=alert(1)>") === "", "svg data uri");
  assert(sanitizeMediaUrl("data:image/png;base64,aaaa") === "", "png data uri");
  assert(sanitizeMediaUrl("/m/../etc/passwd.webp") === "", "path travel media");
  assert(sanitizeMediaUrl("/icons/../../etc/passwd.svg") === "", "path travel icon");
  assert(sanitizeMediaUrl("//evil.example/m/0123456789abcdef0123.webp") === "", "protocol-relative media");
  assert(
    sanitizeMediaUrl("https://cdn.example/m/0123456789abcdef0123.webp", { extraOrigins: ["https://cdn.example"] }) ===
      "https://cdn.example/m/0123456789abcdef0123.webp",
    "allowlisted CDN",
  );
}

{
  const addr = "0x1111111111111111111111111111111111110001";
  assert(sanitizeAddress(addr) === addr, "address ok");
  assert(sanitizeAddress("0x123") === "", "short address");
  assert(sanitizeAddress(`${addr}" onclick="alert(1)`) === "", "attribute break address");
  assert(tokenPath(addr) === `/token/${addr}`, "token path");
  assert(tokenPath("javascript:alert(1)") === "/", "js token path");
  assert(tokenPath("../admin") === "/", "relative token path");
  assert(fairPath(1n) === "/fair/1", "fair id");
  assert(fairPath("1;alert(1)") === "/", "fair injection");
  assert(fairPath("-1") === "/", "negative fair");
  assert(quotePath("ZEC") === "/quote/ZEC", "quote path");
  assert(quotePath("zec<script>") === "/quote/ZEC", "quote strips");
  assert(launchPath({ mode: 0, marketLive: true, fairId: 0n, token: addr }) === `/token/${addr}`, "instant href");
  assert(launchPath({ mode: 1, marketLive: false, fairId: 9n, token: addr }) === "/fair/9", "fair href");
}

{
  assert(sanitizeDocHref("/docs/fees") === "/docs/fees", "relative docs");
  assert(sanitizeDocHref("#trust") === "#trust", "hash");
  assert(sanitizeDocHref("javascript:alert(1)") == null, "docs js");
  assert(sanitizeDocHref("https://example.com/x") === "https://example.com/x", "docs https");
  assert(sanitizeDocHref("//evil.example") == null, "docs protocol-relative");
}

{
  const reasons = untrustedMetadataReasons({
    name: "<script>x</script>",
    image: "javascript:alert(1)",
    website: "javascript:alert(1)",
    twitter: "https://evil.example/x",
    telegram: "https://evil.example/x",
    description: "javascript:alert(1)",
  });
  for (const r of ["name-html", "image-url", "website-url", "twitter-url", "telegram-url", "description-scheme"]) {
    assert(reasons.includes(r), `reason ${r} in ${reasons}`);
  }
  assert(untrustedMetadataReasons({ name: "Cat", image: "", website: "", twitter: "", telegram: "" }).length === 0, "empty urls ok");
  assert(
    untrustedMetadataReasons({ name: "Cat", image: "/m/0123456789abcdef0123.webp", website: "https://example.com" }).length === 0,
    "valid metadata",
  );
}

{
  const dirty = sanitizeLaunchFields({
    token: '0x1111111111111111111111111111111111110001"><img src=x onerror=alert(1)>',
    name: '<script>alert(1)</script>ZCAT',
    symbol: "ZCAT<svg>",
    image: "javascript:alert(document.domain)",
    description: '<img src=x onerror=alert(1)>holders earn',
    website: "javascript:alert(1)",
    twitter: "https://evil.example/x",
    telegram: "data:text/html,hi",
    quoteSymbol: "ZEC",
  });
  assert(dirty.token === "", "malicious token dropped");
  assert(dirty.name === "alert(1)ZCAT", "name stripped");
  assert(!String(dirty.name).includes("<"), "name has no brackets");
  assert(dirty.symbol === "ZCAT", "ticker clean");
  assert(dirty.image === "", "js image dropped");
  assert(dirty.description === "holders earn", "description stripped");
  assert(dirty.website === "", "js website dropped");
  assert(dirty.twitter === "", "evil twitter dropped");
  assert(dirty.telegram === "", "data telegram dropped");
  assert(dirty.quoteSymbol === "ZEC", "quote kept");
}

{
  const root = join(import.meta.dirname, "../../../apps/web/src");
  const files = walk(root);
  assert(files.length > 10, "walked web src");
  let joined = "";
  for (const f of files) joined += `\n${readFileSync(f, "utf8")}`;
  assert(!joined.includes("dangerouslySetInnerHTML"), "no raw HTML sink in web src");
  assert(!/<img\b[^>]*src=\{t\.image\}/.test(joined), "no raw img src={t.image}");
  assert(!/<img\b[^>]*src=\{image\}/.test(joined), "no raw img src={image}");
  assert(joined.includes("SafeTokenImage"), "SafeTokenImage is used");
  assert(joined.includes("sanitizeLaunchFields") || joined.includes("sanitizeMediaUrl"), "hooks sanitize");
}

console.log("untrusted-metadata tests ok");
