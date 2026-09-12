import { randomUUID } from "node:crypto";

export function requestId(req?: { headers?: { get?: (k: string) => string | null; [k: string]: unknown } } | { headers: Record<string, string | string[] | undefined> }): string {
  const h = req?.headers;
  if (h && typeof (h as { get?: (k: string) => string | null }).get === "function") {
    return (h as { get: (k: string) => string | null }).get("x-request-id") ?? randomUUID();
  }
  const rec = (h ?? {}) as Record<string, string | string[] | undefined>;
  const v = rec["x-request-id"] ?? rec["X-Request-Id"];
  return (Array.isArray(v) ? v[0] : v) || randomUUID();
}

export function logLine(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: Date.now(), ...fields }));
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-DNS-Prefetch-Control": "off",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "X-Permitted-Cross-Domain-Policies": "none",
};

export class RateLimit {
  private hits = new Map<string, number[]>();
  constructor(private windowMs: number, private max: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
