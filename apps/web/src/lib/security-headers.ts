/**
 * Production launchpad security headers + CSP.
 * img-src is first-party + indexer/CDN — not https:.
 * HSTS / upgrade-insecure-requests only when REACTOR_ENV=PROD (not next start on http).
 */

function extraConnectSrc(): string[] {
  const out = new Set<string>([
    "http://127.0.0.1:8545",
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

export function contentSecurityPolicy(): string {
  const script = ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"];
  if (process.env.NODE_ENV !== "production") script.push("'unsafe-eval'");
  const parts = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${script.join(" ")}`,
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
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  ];
  if (httpsEnforced()) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
