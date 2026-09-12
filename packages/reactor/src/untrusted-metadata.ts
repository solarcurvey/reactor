/**
 * Creator-controlled token identity is untrusted.
 * Names, tickers, descriptions, social URLs, and images can be set by anyone
 * who launches. The public UI must never treat them as HTML or as an open URL.
 *
 * This module is the single allowlist. Admission DENYs bad schemes before
 * sign. The launchpad still sanitizes on read — onchain history is not trusted.
 */

export const DISPLAY_NAME_MAX = 64;
export const DISPLAY_TICKER_MAX = 10;
export const DISPLAY_DESCRIPTION_MAX = 500;
export const DISPLAY_URL_MAX = 256;

const HTML_TAG = /<\/?[a-zA-Z!?/]/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const DANGEROUS_SCHEME =
  /^(javascript|data|vbscript|file|blob|about|intent|chrome|ms-help|view-source|moz-extension|chrome-extension):/i;

const TWITTER_HOSTS = new Set(["twitter.com", "www.twitter.com", "mobile.twitter.com", "x.com", "www.x.com"]);
const TELEGRAM_HOSTS = new Set(["t.me", "www.t.me", "telegram.me", "www.telegram.me"]);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export type MediaPolicy = {
  extraOrigins?: string[];
  allowHttpLocal?: boolean;
};

function asString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw == null) return "";
  return String(raw);
}

/** Fold whitespace/controls so `java\nscript:` still matches. */
export function foldedSchemeProbe(raw: string): string {
  return raw.replace(/[\s\\]|[\u0000-\u001F\u007F-\u009F]/g, "");
}

export function hasDangerousScheme(raw: string): boolean {
  const folded = foldedSchemeProbe(raw).trim();
  return DANGEROUS_SCHEME.test(folded);
}

export function containsHtmlTag(raw: string): boolean {
  return HTML_TAG.test(raw);
}

export function sanitizeDisplayText(raw: unknown, maxLen: number): string {
  let s = asString(raw);
  s = s.replace(CONTROL_CHARS, "").replace(BIDI, "");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

export function sanitizeTokenName(raw: unknown): string {
  const s = sanitizeDisplayText(raw, DISPLAY_NAME_MAX);
  return s.length >= 1 ? s : "Token";
}

export function sanitizeTicker(raw: unknown): string {
  const s = sanitizeDisplayText(raw, DISPLAY_TICKER_MAX + 32)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return s.slice(0, DISPLAY_TICKER_MAX);
}

export function sanitizeDescription(raw: unknown): string {
  return sanitizeDisplayText(raw, DISPLAY_DESCRIPTION_MAX);
}

export function isEvmAddress(raw: unknown): raw is `0x${string}` {
  return typeof raw === "string" && /^0x[a-fA-F0-9]{40}$/.test(raw);
}

export function sanitizeAddress(raw: unknown): `0x${string}` | "" {
  const s = asString(raw).trim();
  return isEvmAddress(s) ? (s as `0x${string}`) : "";
}

export function sanitizeFairId(raw: unknown): string {
  if (typeof raw === "bigint" && raw >= 0n) return raw.toString();
  const s = asString(raw).trim();
  if (!/^\d{1,78}$/.test(s)) return "";
  return s;
}

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return LOCAL_HOSTS.has(h) || LOCAL_HOSTS.has(hostname.toLowerCase());
}

export function parseAllowlistedHttpUrl(
  raw: unknown,
  opts: { allowHttpLocal?: boolean } = {},
): URL | null {
  const input = asString(raw).trim();
  if (!input || input.length > DISPLAY_URL_MAX) return null;
  if (hasDangerousScheme(input)) return null;
  if (input.startsWith("//") || input.startsWith("\\\\")) return null;
  if (containsHtmlTag(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  if (opts.allowHttpLocal !== false && url.protocol === "http:" && isLocalHost(url.hostname)) return url;
  return null;
}

export function sanitizeExternalUrl(raw: unknown): string | null {
  const empty = asString(raw).trim();
  if (!empty) return null;
  const url = parseAllowlistedHttpUrl(raw, { allowHttpLocal: true });
  if (!url) return null;
  return url.href;
}

export function sanitizeWebsiteUrl(raw: unknown): string {
  return sanitizeExternalUrl(raw) ?? "";
}

function socialHandle(raw: string): string | null {
  const s = raw.trim();
  const m = /^@?([A-Za-z0-9_]{1,32})$/.exec(s);
  return m ? m[1]! : null;
}

export function sanitizeTwitterUrl(raw: unknown): string {
  const input = asString(raw).trim();
  if (!input) return "";
  const handle = socialHandle(input);
  if (handle) return `https://x.com/${handle}`;
  const url = parseAllowlistedHttpUrl(input, { allowHttpLocal: false });
  if (!url) return "";
  const host = url.hostname.toLowerCase();
  if (!TWITTER_HOSTS.has(host)) return "";
  if (url.protocol !== "https:") return "";
  return url.href;
}

export function sanitizeTelegramUrl(raw: unknown): string {
  const input = asString(raw).trim();
  if (!input) return "";
  const handle = socialHandle(input);
  if (handle) return `https://t.me/${handle}`;
  const url = parseAllowlistedHttpUrl(input, { allowHttpLocal: false });
  if (!url) return "";
  const host = url.hostname.toLowerCase();
  if (!TELEGRAM_HOSTS.has(host)) return "";
  if (url.protocol !== "https:") return "";
  return url.href;
}

const MEDIA_PATH = /^\/m\/[a-fA-F0-9]{16,64}\.webp$/;
const ICON_PATH = /^\/icons\/[a-zA-Z0-9._-]+\.(svg|webp|png|jpe?g|gif)$/;

export function defaultMediaOrigins(): string[] {
  const out = new Set<string>();
  for (const raw of [
    process.env.NEXT_PUBLIC_INDEXER_URL,
    process.env.NEXT_PUBLIC_MEDIA_CDN_BASE,
    process.env.MEDIA_CDN_BASE,
    process.env.INDEXER_PUBLIC_URL,
    "http://127.0.0.1:43148",
    "http://localhost:43148",
  ]) {
    if (!raw) continue;
    try {
      out.add(new URL(raw).origin);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

function sanitizeRelativeMediaPath(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("..")) return null;
  let pathname = path;
  try {
    pathname = new URL(path, "https://reactor.invalid").pathname;
  } catch {
    return null;
  }
  if (MEDIA_PATH.test(pathname) || ICON_PATH.test(pathname)) return pathname;
  return null;
}

export function sanitizeMediaUrl(raw: unknown, policy: MediaPolicy = {}): string {
  const input = asString(raw).trim();
  if (!input || input.length > DISPLAY_URL_MAX) return "";
  if (hasDangerousScheme(input)) return "";
  if (containsHtmlTag(input)) return "";
  if (input.startsWith("/")) return sanitizeRelativeMediaPath(input) ?? "";

  const allowHttpLocal = policy.allowHttpLocal !== false;
  const url = parseAllowlistedHttpUrl(input, { allowHttpLocal });
  if (!url) return "";
  if (!MEDIA_PATH.test(url.pathname)) return "";
  const allowed = new Set([...(policy.extraOrigins ?? []), ...defaultMediaOrigins()]);
  if (!allowed.has(url.origin)) return "";
  return `${url.origin}${url.pathname}`;
}

export type MetadataUrlInput = {
  name?: string;
  description?: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
};

/**
 * Admission DENY reasons for creator metadata.
 * Empty fields are fine. Dangerous schemes / HTML names / off-policy media are not.
 */
export function untrustedMetadataReasons(meta: MetadataUrlInput | undefined): string[] {
  const reasons: string[] = [];
  if (!meta) return reasons;
  const name = asString(meta.name);
  if (name && (containsHtmlTag(name) || hasDangerousScheme(name))) reasons.push("name-html");
  const description = asString(meta.description);
  if (description && hasDangerousScheme(description)) reasons.push("description-scheme");
  const image = asString(meta.image).trim();
  if (image && !sanitizeMediaUrl(image)) reasons.push("image-url");
  const website = asString(meta.website).trim();
  if (website && !sanitizeWebsiteUrl(website)) reasons.push("website-url");
  const twitter = asString(meta.twitter).trim();
  if (twitter && !sanitizeTwitterUrl(twitter)) reasons.push("twitter-url");
  const telegram = asString(meta.telegram).trim();
  if (telegram && !sanitizeTelegramUrl(telegram)) reasons.push("telegram-url");
  return reasons;
}

export type UntrustedLaunchFields = {
  token?: unknown;
  name?: unknown;
  symbol?: unknown;
  ticker?: unknown;
  image?: unknown;
  description?: unknown;
  website?: unknown;
  twitter?: unknown;
  telegram?: unknown;
  quoteSymbol?: unknown;
};

export function sanitizeLaunchFields<T extends UntrustedLaunchFields>(row: T): T {
  const token = sanitizeAddress(row.token);
  return {
    ...row,
    token: typeof row.token === "string" ? token : row.token,
    name: sanitizeTokenName(row.name),
    symbol: sanitizeTicker(row.symbol) || "TKN",
    ticker: row.ticker != null && asString(row.ticker) ? sanitizeTicker(row.ticker) : sanitizeTicker(row.symbol),
    image: sanitizeMediaUrl(row.image),
    description: sanitizeDescription(row.description),
    website: sanitizeWebsiteUrl(row.website),
    twitter: sanitizeTwitterUrl(row.twitter),
    telegram: sanitizeTelegramUrl(row.telegram),
    quoteSymbol: row.quoteSymbol != null ? sanitizeTicker(row.quoteSymbol) : row.quoteSymbol,
  };
}

export function tokenPath(address: unknown): string {
  const a = sanitizeAddress(address);
  return a ? `/token/${a}` : "/";
}

export function fairPath(id: unknown): string {
  const n = sanitizeFairId(id);
  return n ? `/fair/${n}` : "/";
}

export function quotePath(symbol: unknown): string {
  const s = sanitizeTicker(symbol);
  return s ? `/quote/${encodeURIComponent(s)}` : "/";
}

export function launchPath(t: { mode: number; marketLive: boolean; fairId: unknown; token: unknown }): string {
  if (t.mode === 1 && !t.marketLive) return fairPath(t.fairId);
  return tokenPath(t.token);
}

/** First-party docs / app links. External https only. */
export function sanitizeDocHref(raw: unknown): string | null {
  const input = asString(raw).trim();
  if (!input || input.length > DISPLAY_URL_MAX) return null;
  if (hasDangerousScheme(input) || containsHtmlTag(input)) return null;
  if (input.startsWith("#")) {
    if (input.includes(":") || input.includes("\\")) return null;
    return input;
  }
  if (input.startsWith("/") && !input.startsWith("//")) {
    if (input.includes("\\") || input.includes("..") || /[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) return null;
    return input;
  }
  return sanitizeExternalUrl(input);
}
