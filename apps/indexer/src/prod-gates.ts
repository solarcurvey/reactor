/** Production hard gates. LOCAL may keep Turnstile / Anvil / inline-signer bypasses. */

export const ANVIL0_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export function isLocalEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.REACTOR_ENV ?? "").toUpperCase() === "LOCAL";
}

/**
 * Hard gates apply when REACTOR_ENV is a non-LOCAL production-like value,
 * or when NODE_ENV=production and REACTOR_ENV is not LOCAL.
 * Unset REACTOR_ENV + non-production NODE_ENV stays local-demo (bypasses allowed).
 */
export function productionHardGatesApply(env: NodeJS.ProcessEnv = process.env): boolean {
  const reactor = (env.REACTOR_ENV ?? "").toUpperCase();
  if (reactor === "LOCAL") return false;
  if (reactor === "PROD" || reactor === "PRODUCTION" || reactor === "STAGING" || reactor === "TESTNET") return true;
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") return true;
  return false;
}

export function productionHardGateFailures(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!productionHardGatesApply(env)) return [];
  const missing: string[] = [];
  if (!env.TURNSTILE_SECRET?.trim()) missing.push("TURNSTILE_SECRET");
  if (!(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? env.TURNSTILE_SITE_KEY)?.trim()) {
    missing.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY (or TURNSTILE_SITE_KEY)");
  }
  if (!env.PRICING_SIGNER_PK?.trim() || env.PRICING_SIGNER_PK.length < 10) {
    missing.push("PRICING_SIGNER_PK");
  }
  if (env.PRICING_SIGNER_PK && env.PRICING_SIGNER_PK.toLowerCase() === ANVIL0_PK) {
    missing.push("PRICING_SIGNER_PK must not be the Anvil #0 key");
  }
  if (env.SIGNER_INLINE === "1" || env.SIGNER_INLINE === "true") {
    missing.push("SIGNER_INLINE must not be enabled (inline/Anvil signer fallback forbidden)");
  }
  if (!env.SIGNER_INTERNAL_TOKEN?.trim()) missing.push("SIGNER_INTERNAL_TOKEN");
  if (!env.ADMISSION_HMAC_SECRET?.trim() || env.ADMISSION_HMAC_SECRET.length < 16) {
    missing.push("ADMISSION_HMAC_SECRET");
  }
  return missing;
}

export function assertProductionHardGates(env: NodeJS.ProcessEnv = process.env): void {
  const missing = productionHardGateFailures(env);
  if (missing.length) {
    throw new Error(`PRODUCTION_HARD_GATES: refuse start/launch — ${missing.join("; ")}`);
  }
}

/** True when an Anvil/inline signer fallback would be used. LOCAL only. */
export function wouldUseAnvilSignerFallback(env: NodeJS.ProcessEnv = process.env): boolean {
  const hasPk = Boolean(env.PRICING_SIGNER_PK && env.PRICING_SIGNER_PK.length >= 10);
  if (hasPk && env.PRICING_SIGNER_PK!.toLowerCase() !== ANVIL0_PK) return false;
  if (isLocalEnv(env)) return !hasPk || env.PRICING_SIGNER_PK!.toLowerCase() === ANVIL0_PK;
  return !hasPk || env.PRICING_SIGNER_PK!.toLowerCase() === ANVIL0_PK;
}
