export type AdmissionDecision = "ALLOW" | "CHALLENGE" | "DENY";
export type IssuanceLevel = "NORMAL" | "ELEVATED" | "ATTACK";

export type AdmissionSignals = {
  ticker: string;
  quote?: string;
  factory?: string;
  metadata?: { name?: string; description?: string; imageHash?: string };
  wallet?: string;
  session?: string;
  ip?: string;
  asn?: string;
  client?: string;
  turnstileOk?: boolean;
  turnstileRequired?: boolean;
  fundedCluster?: string;
  clusterLaunches?: number;
  recentLaunches?: number;
  imageHashRepeats?: number;
  sessionHits?: number;
  ipHits?: number;
  walletHits?: number;
};

export type AdmissionResult = {
  decision: AdmissionDecision;
  reasons: string[];
  level: IssuanceLevel;
  challenge?: "turnstile" | "delay";
};

const CLUSTER_CHALLENGE = 3;
const CLUSTER_DENY_ATTACK = 1;

/** CHALLENGE is never ALLOW. Missing Turnstile when required is CHALLENGE, not a signature. */
export function evaluateAdmission(signals: AdmissionSignals, level: IssuanceLevel = "NORMAL"): AdmissionResult {
  const reasons: string[] = [];
  if (!signals.ticker) reasons.push("ticker required");
  if (signals.quote && !/^0x[0-9a-fA-F]{40}$/.test(signals.quote)) reasons.push("quote");
  if (signals.factory && !/^0x[0-9a-fA-F]{40}$/.test(signals.factory)) reasons.push("factory");
  if (!signals.metadata?.name || signals.metadata.name.trim().length < 2) reasons.push("name");

  const turnstileRequired = signals.turnstileRequired === true || level !== "NORMAL";
  if (signals.turnstileOk === false && (turnstileRequired || signals.turnstileRequired !== false)) {
    reasons.push("turnstile");
  }

  if (level === "ATTACK" && (signals.recentLaunches ?? 0) > 0) reasons.push("global throttle");
  if ((signals.recentLaunches ?? 0) > (level === "ELEVATED" ? 3 : 12)) reasons.push("wallet rate");
  if ((signals.walletHits ?? 0) > (level === "ATTACK" ? 1 : level === "ELEVATED" ? 3 : 8)) reasons.push("wallet rate");
  if ((signals.ipHits ?? 0) > (level === "ATTACK" ? 2 : level === "ELEVATED" ? 8 : 40)) reasons.push("ip rate");
  if ((signals.sessionHits ?? 0) > (level === "ATTACK" ? 1 : 10)) reasons.push("session rate");
  if ((signals.imageHashRepeats ?? 0) > 3) reasons.push("image-hash cluster");
  if ((signals.clusterLaunches ?? 0) > (level === "ATTACK" ? CLUSTER_DENY_ATTACK : CLUSTER_CHALLENGE)) {
    reasons.push("funding-cluster");
  }

  const hardDeny =
    reasons.includes("ticker required") ||
    reasons.includes("global throttle") ||
    reasons.includes("quote") ||
    reasons.includes("factory") ||
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
    reasons.includes("name") ||
    level !== "NORMAL" ||
    signals.turnstileOk === false;

  if (needsChallenge) {
    return { decision: "CHALLENGE", reasons, level, challenge: "turnstile" };
  }

  return { decision: "ALLOW", reasons: [], level };
}

export function issuanceFromCounts(launchesLastHour: number, envOverride?: string): IssuanceLevel {
  const env = (envOverride ?? "").toUpperCase();
  if (env === "ELEVATED" || env === "ATTACK" || env === "NORMAL") return env;
  if (launchesLastHour >= 200) return "ATTACK";
  if (launchesLastHour >= 60) return "ELEVATED";
  return "NORMAL";
}
