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
  turnstileOk?: boolean;
  fundedCluster?: string;
  recentLaunches?: number;
};

export type AdmissionResult = {
  decision: AdmissionDecision;
  reasons: string[];
  level: IssuanceLevel;
  challenge?: "turnstile" | "delay";
};

export function evaluateAdmission(signals: AdmissionSignals, level: IssuanceLevel = "NORMAL"): AdmissionResult {
  const reasons: string[] = [];
  if (!signals.ticker) reasons.push("ticker required");
  if (signals.turnstileOk === false) reasons.push("turnstile");
  if (level === "ATTACK" && (signals.recentLaunches ?? 0) > 0) reasons.push("global throttle");
  if ((signals.recentLaunches ?? 0) > (level === "ELEVATED" ? 3 : 12)) reasons.push("wallet rate");
  if (reasons.length && (reasons.includes("turnstile") || reasons.includes("global throttle"))) {
    return { decision: "DENY", reasons, level };
  }
  if (reasons.length || level !== "NORMAL" || !signals.turnstileOk) {
    return { decision: reasons.length ? "DENY" : "CHALLENGE", reasons, level, challenge: "turnstile" };
  }
  return { decision: "ALLOW", reasons: [], level };
}
