/**
 * Client-bundle secret sentinel.
 * Keeper / Launch signer / Guardian ops keys and private RPC credentials
 * must never be readable as NEXT_PUBLIC_* or appear in built browser assets.
 */

export const CLIENT_FORBIDDEN_ENV = [
  "NEXT_PUBLIC_KEEPER_PRIVATE_KEY",
  "NEXT_PUBLIC_KEEPER_PK",
  "NEXT_PUBLIC_PRICING_SIGNER_PK",
  "NEXT_PUBLIC_PRICING_SIGNER_KEY",
  "NEXT_PUBLIC_TURNSTILE_SECRET",
  "NEXT_PUBLIC_ADMISSION_HMAC_SECRET",
  "NEXT_PUBLIC_R2_SECRET_KEY",
  "NEXT_PUBLIC_R2_SECRET_ACCESS_KEY",
  "NEXT_PUBLIC_SIGNER_INTERNAL_TOKEN",
  "NEXT_PUBLIC_DEPLOYER_PK",
  "NEXT_PUBLIC_ARC_TESTNET_PK",
  "NEXT_PUBLIC_RPC_URL_FALLBACK",
  "NEXT_PUBLIC_OPS_TOKEN",
] as const;

/** Server-only names that must not be read from apps/web client source. */
export const SERVER_ONLY_ENV = [
  "KEEPER_PRIVATE_KEY",
  "PRICING_SIGNER_PK",
  "TURNSTILE_SECRET",
  "ADMISSION_HMAC_SECRET",
  "R2_SECRET_KEY",
  "SIGNER_INTERNAL_TOKEN",
  "DEPLOYER_PK",
  "ARC_TESTNET_PK",
  "RPC_URL_FALLBACK",
  "OPS_TOKEN",
] as const;

/** Well-known Anvil account #0 private key (local-only; never ship in client assets). */
export const ANVIL_ACCOUNT0_PK = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const SENTINEL_SELF = /secret-sentinel|scan-client-bundle/;

export function isSentinelSelf(filePath: string): boolean {
  return SENTINEL_SELF.test(filePath.replace(/\\/g, "/"));
}

export function forbiddenNeedles(): string[] {
  return [...CLIENT_FORBIDDEN_ENV, ANVIL_ACCOUNT0_PK];
}

export function sourceLeakNeedles(): string[] {
  return [...CLIENT_FORBIDDEN_ENV, ...SERVER_ONLY_ENV.map((n) => `process.env.${n}`), ANVIL_ACCOUNT0_PK];
}

export function findSecretNeedles(text: string, needles: readonly string[]): string[] {
  const hits: string[] = [];
  const lower = text;
  for (const needle of needles) {
    if (lower.includes(needle)) hits.push(needle);
  }
  return hits;
}
