import { untrustedMetadataReasons } from "./untrusted-metadata.ts";

export type AdmissionDecision = "ALLOW" | "CHALLENGE" | "DENY";
export type IssuanceLevel = "NORMAL" | "ELEVATED" | "ATTACK";

export type AdmissionSignals = {
  ticker: string;
  quote?: string;
  factory?: string;
  metadata?: {
    name?: string;
    description?: string;
    imageHash?: string;
    image?: string;
    website?: string;
    twitter?: string;
    telegram?: string;
  };
  wallet?: string;
  session?: string;
  ip?: string;
  asn?: string;
  client?: string;
  turnstileOk?: boolean;
  turnstileRequired?: boolean;
  fundedCluster?: string;
  clusterLaunches?: number;
  /** Signed LaunchAuthorization count in the window — not pre-incremented admit hits. */
  recentSignedAuths?: number;
  imageHashRepeats?: number;
  sessionHits?: number;
  ipHits?: number;
  walletHits?: number;
  /** Remaining global issuance tokens (atomic bucket). */
  issuanceTokens?: number;
};

export type AdmissionResult = {
  decision: AdmissionDecision;
  reasons: string[];
  level: IssuanceLevel;
  challenge?: "turnstile" | "delay";
};

const CLUSTER_CHALLENGE = 3;
const CLUSTER_DENY_ATTACK = 1;

/** Caps on signed LaunchAuthorization issuance per hour (token-bucket capacity). */
export const ISSUANCE_CAP: Record<IssuanceLevel, number> = {
  NORMAL: 120,
  ELEVATED: 40,
  ATTACK: 12,
};

export function walletRateLimit(level: IssuanceLevel): number {
  return level === "ATTACK" ? 1 : level === "ELEVATED" ? 3 : 8;
}

export function ipRateLimit(level: IssuanceLevel): number {
  return level === "ATTACK" ? 2 : level === "ELEVATED" ? 8 : 40;
}

export function sessionRateLimit(level: IssuanceLevel): number {
  return level === "ATTACK" ? 1 : 10;
}

/**
 * CHALLENGE is never ALLOW.
 * ELEVATED/ATTACK require Turnstile. A solved challenge ALLOWs when under rate + issuance limits.
 * No infinite CHALLENGE loop after a valid token.
 */
export function evaluateAdmission(signals: AdmissionSignals, level: IssuanceLevel = "NORMAL"): AdmissionResult {
  const reasons: string[] = [];
  if (!signals.ticker) reasons.push("ticker required");
  if (signals.quote && !/^0x[0-9a-fA-F]{40}$/.test(signals.quote)) reasons.push("quote");
  if (signals.factory && !/^0x[0-9a-fA-F]{40}$/.test(signals.factory)) reasons.push("factory");
  if (!signals.metadata?.name || signals.metadata.name.trim().length < 2) reasons.push("name");
  reasons.push(...untrustedMetadataReasons(signals.metadata));

  const turnstileRequired = signals.turnstileRequired === true || level !== "NORMAL";
  if (turnstileRequired && signals.turnstileOk !== true) {
    reasons.push("turnstile");
  }

  if ((signals.issuanceTokens ?? 1) < 1) reasons.push("issuance throttle");
  if ((signals.recentSignedAuths ?? 0) >= ISSUANCE_CAP[level]) reasons.push("issuance throttle");
  if ((signals.walletHits ?? 0) > walletRateLimit(level)) reasons.push("wallet rate");
  if ((signals.ipHits ?? 0) > ipRateLimit(level)) reasons.push("ip rate");
  if ((signals.sessionHits ?? 0) > sessionRateLimit(level)) reasons.push("session rate");
  if ((signals.imageHashRepeats ?? 0) > 3) reasons.push("image-hash cluster");
  if ((signals.clusterLaunches ?? 0) > (level === "ATTACK" ? CLUSTER_DENY_ATTACK : CLUSTER_CHALLENGE)) {
    reasons.push("funding-cluster");
  }

  const metadataDeny = reasons.some(
    (r) =>
      r === "name-html" ||
      r === "description-scheme" ||
      r === "image-url" ||
      r === "website-url" ||
      r === "twitter-url" ||
      r === "telegram-url",
  );
  const hardDeny =
    reasons.includes("ticker required") ||
    reasons.includes("issuance throttle") ||
    reasons.includes("quote") ||
    reasons.includes("factory") ||
    metadataDeny ||
    (level === "ATTACK" && reasons.includes("funding-cluster"));

  if (hardDeny) {
    return { decision: "DENY", reasons, level };
  }

  const needsChallenge =
    reasons.includes("turnstile") ||
    reasons.includes("ip rate") ||
    reasons.includes("wallet rate") ||
    reasons.includes("session rate") ||
    reasons.includes("image-hash cluster") ||
    reasons.includes("funding-cluster") ||
    reasons.includes("name");

  if (needsChallenge) {
    return { decision: "CHALLENGE", reasons, level, challenge: "turnstile" };
  }

  return { decision: "ALLOW", reasons: [], level };
}

export function issuanceFromCounts(signedAuthsLastHour: number, envOverride?: string): IssuanceLevel {
  const env = (envOverride ?? "").toUpperCase();
  if (env === "ELEVATED" || env === "ATTACK" || env === "NORMAL") return env;
  if (signedAuthsLastHour >= 200) return "ATTACK";
  if (signedAuthsLastHour >= 60) return "ELEVATED";
  return "NORMAL";
}
