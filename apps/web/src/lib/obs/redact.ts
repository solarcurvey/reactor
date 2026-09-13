/** Privacy redaction for production telemetry. Secrets never leave the browser/BFF. */

const REDACTED = "[redacted]";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "mnemonic",
  "seed",
  "seedphrase",
  "privatekey",
  "privkey",
  "apikey",
  "accesskey",
  "secretkey",
  "turnstile",
  "turnstileticket",
  "captcha",
  "signature",
  "sig",
  "xopstoken",
  "opstoken",
  "xpartnerkey",
  "partnerkey",
  "bearer",
  "jwt",
  "session",
  "sessionid",
  "sentrydsn",
  "pricingsignerpk",
  "keeperprivatekey",
  "deployerpk",
  "signerinlinetoken",
  "signerinternaltoken",
  "admissionhmacsecret",
  "turnstilesecret",
  "walletconnectid",
  "auth",
]);

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  const k = normalizeKey(key);
  if (SENSITIVE_KEYS.has(k)) return true;
  if (k.includes("privatekey") || k.includes("mnemonic") || k.includes("seedphrase")) return true;
  if (k.includes("turnstile") || k.includes("authorization")) return true;
  if (k.endsWith("secret") || k.endsWith("password")) return true;
  if (k.endsWith("signature") || k === "cfturnstileresponse") return true;
  return false;
}

export function looksLikeMnemonic(s: string): boolean {
  const words = s.trim().toLowerCase().split(/\s+/);
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  return words.every((w) => /^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 12);
}

function truncateHex32(hex64: string): string {
  return `0x${hex64.slice(0, 8)}…${hex64.slice(-6)}`;
}

const SENSITIVE_QUERY = /^(sig|signature|key|auth|secret|turnstile|ops|token|password|mnemonic|privatekey)$/i;

export function redactUrl(url: string): string {
  try {
    const base = url.startsWith("/") ? "http://reactor.invalid" : undefined;
    const u = new URL(url, base);
    if (u.username || u.password) {
      u.username = "redacted";
      u.password = "";
    }
    for (const [k, v] of [...u.searchParams.entries()]) {
      if (isSensitiveKey(k) || SENSITIVE_QUERY.test(k)) {
        if (/^0x[a-fA-F0-9]{40}$/.test(v) && /^token$/i.test(k)) continue;
        u.searchParams.set(k, REDACTED);
      }
    }
    const out = u.toString();
    return base ? out.replace(/^http:\/\/reactor\.invalid/, "") : out;
  } catch {
    return redactString(url);
  }
}

const EMBEDDED_MNEMONIC = /\b[a-z]{3,12}(?:\s+[a-z]{3,12}){11,23}\b/g;

export function redactString(value: string, keyHint?: string): string {
  if (keyHint && isSensitiveKey(keyHint)) return REDACTED;
  if (looksLikeMnemonic(value)) return "[redacted-mnemonic]";
  let out = value;
  out = out.replace(EMBEDDED_MNEMONIC, (m) => (looksLikeMnemonic(m) ? "[redacted-mnemonic]" : m));
  out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^/\s]*:[^/\s@]+@/gi, (m) =>
    m.replace(/\/\/[^@]*@/, "//[redacted]@"),
  );
  out = out.replace(/\b(Bearer|Basic|Token)\s+\S+/gi, "$1 [redacted]");
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]");
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-aws]");
  out = out.replace(/\b0x[a-fA-F0-9]{130}\b/g, "[redacted-sig]");
  out = out.replace(/\b0x([a-fA-F0-9]{64})\b/g, (_, h: string) => truncateHex32(h));
  if (/^[a-fA-F0-9]{64}$/.test(out)) return `${out.slice(0, 8)}…${out.slice(-6)}`;
  if (out.length > 1800) out = `${out.slice(0, 1800)}…`;
  return out;
}

export function redactUnknown(value: unknown, keyHint?: string, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (keyHint && isSensitiveKey(keyHint)) return REDACTED;
    if (value.startsWith("http") || value.startsWith("/")) return redactUrl(value);
    return redactString(value, keyHint);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => redactUnknown(v, keyHint, depth + 1));
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec).slice(0, 64)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = redactUnknown(v, k, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function redactEvent<T>(event: T): T {
  return redactUnknown(event) as T;
}

export function containsResidualSecret(value: unknown): boolean {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (looksLikeMnemonic(s)) return true;
  const embedded = s.match(EMBEDDED_MNEMONIC);
  if (embedded?.some((m) => looksLikeMnemonic(m))) return true;
  if (/\b0x[a-fA-F0-9]{130}\b/.test(s)) return true;
  if (/\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{12,}/i.test(s)) return true;
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(s)) return true;
  if (/\bAKIA[0-9A-Z]{16}\b/.test(s)) return true;
  if (/\b0x[a-fA-F0-9]{64}\b/.test(s)) return true;
  return false;
}
