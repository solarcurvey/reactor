/**
 * Production launchpad security headers + CSP.
 *
 * CSP is applied per-request in middleware (nonce). Static next.config headers
 * must not also send Content-Security-Policy — browsers AND multiple CSPs.
 *
 * img-src is first-party + indexer/CDN — not https:.
 * HSTS / upgrade-insecure-requests only when REACTOR_ENV=PROD (not next start on http).
 */

export type CspOptions = {
  nonce?: string;
  production?: boolean;
};

function extraConnectSrc(): string[] {
  const out = new Set<string>([
    "http://127.0.0.1:8545",
    "http://127.0.0.1:18448",
    "http://127.0.0.1:18545",
    "http://127.0.0.1:43148",
    "http://127.0.0.1:43149",
    "http://localhost:8545",
    "http://localhost:43148",
    "https://rpc.testnet.arc.io",
    "https://challenges.cloudflare.com",
    "https://testnet.arcscan.app",
  ]);
  for (const raw of [
    process.env.NEXT_PUBLIC_RPC_URL,
    process.env.NEXT_PUBLIC_INDEXER_URL,
    process.env.NEXT_PUBLIC_EXPLORER_URL,
    process.env.NEXT_PUBLIC_MEDIA_CDN_BASE,
    process.env.NEXT_PUBLIC_SENTRY_DSN,
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

function extraImgSrc(): string[] {
  const out = new Set<string>(["http://127.0.0.1:43148", "http://localhost:43148"]);
  for (const raw of [process.env.NEXT_PUBLIC_INDEXER_URL, process.env.NEXT_PUBLIC_MEDIA_CDN_BASE]) {
    if (!raw) continue;
    try {
      out.add(new URL(raw).origin);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

export function httpsEnforced(): boolean {
  return (process.env.REACTOR_ENV ?? "").toUpperCase() === "PROD";
}

export function isProductionCsp(opts: CspOptions = {}): boolean {
  return opts.production ?? process.env.NODE_ENV === "production";
}

/**
 * Production `script-src` uses a per-request nonce + `strict-dynamic`.
 * `'unsafe-inline'` is intentionally absent in production so an injected
 * `<script>` or inline handler cannot run. Next.js reads `x-nonce` and
 * stamps its own bootstrap scripts. Cloudflare Turnstile's first script
 * gets the same nonce; `strict-dynamic` allows scripts it inserts.
 *
 * Residual: `style-src` still has `'unsafe-inline'`. React `style={{}}`,
 * `next/font` injected `<style>`, and Tailwind utilities are not practical
 * to hash per request. That is XSS-weaker than a style nonce (an attacker
 * who can inject a `<style>` or `style=` attribute can phish layout) but
 * it is not script execution. See docs/web-security.md.
 */
export function scriptSrcDirective(opts: CspOptions = {}): string {
  const production = isProductionCsp(opts);
  if (production) {
    if (!opts.nonce) {
      return "script-src 'none'";
    }
    return `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic' https://challenges.cloudflare.com`;
  }
  const parts = ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com", "'unsafe-eval'"];
  if (opts.nonce) parts.splice(1, 0, `'nonce-${opts.nonce}'`);
  return `script-src ${parts.join(" ")}`;
}

export function contentSecurityPolicy(opts: CspOptions = {}): string {
  const parts = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    scriptSrcDirective(opts),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${extraImgSrc().join(" ")}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${extraConnectSrc().join(" ")}`,
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (httpsEnforced()) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Static headers only. CSP is set in middleware with a fresh nonce. */
export function launchpadSecurityHeaders(): { key: string; value: string }[] {
  const headers: { key: string; value: string }[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()",
    },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
  if (httpsEnforced()) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}

export function applyLaunchpadHeaders(headers: Headers, csp: string): void {
  for (const h of launchpadSecurityHeaders()) {
    headers.set(h.key, h.value);
  }
  headers.set("Content-Security-Policy", csp);
}
