/**
 * Canonical combine of address-screen + trusted-geo (#62 / PR #68).
 * Used by the #65 status GET and write gate. Blocked wins over unavailable.
 * Claimed browser wallets are not an input.
 */
import {
  OPERATOR_POLICY_DISCLAIMER,
  OPERATOR_POLICY_ID,
  USER_POLICY_MESSAGES,
  type OperatorPolicyKind,
  type OperatorPolicyReason,
} from "./operator-policy-ux.ts";

export type AddressScreenDecision = "blocked" | "clear" | "unavailable";
export type AddressScreenFreshness = "current" | "stale" | "missing";
export type AddressScreenReason =
  | "missing_dataset"
  | "stale_dataset"
  | "invalid_query"
  | "incompatible_parser"
  | "wallet_missing"
  | "wallet_invalid"
  | "wallet_proof_stale";

export type AddressScreenResult = {
  decision: AddressScreenDecision;
  reason?: AddressScreenReason | string;
  freshness: AddressScreenFreshness;
};

export type GeoPolicyDecisionKind = "ALLOW" | "DENY" | "UNKNOWN";

export type GeoPolicyResult = {
  decision: GeoPolicyDecisionKind;
  reason: string;
};

export type OperatorPolicyDecision = {
  decision: OperatorPolicyKind;
  reason: OperatorPolicyReason;
  userMessage: string;
  httpStatus: 200 | 403 | 503;
  policyId: typeof OPERATOR_POLICY_ID;
  disclaimer: typeof OPERATOR_POLICY_DISCLAIMER;
  addressScreen: AddressScreenResult;
  geo: GeoPolicyResult;
};

const ADDRESS_UNAVAILABLE_REASON: Record<string, OperatorPolicyReason> = {
  missing_dataset: "UNAVAILABLE_DATASET_MISSING",
  stale_dataset: "UNAVAILABLE_DATASET_STALE",
  wallet_missing: "UNAVAILABLE_WALLET_MISSING",
  wallet_invalid: "UNAVAILABLE_WALLET_PROOF",
  wallet_proof_stale: "UNAVAILABLE_WALLET_PROOF",
};

function finish(
  reason: OperatorPolicyReason,
  addressScreen: AddressScreenResult,
  geo: GeoPolicyResult,
): OperatorPolicyDecision {
  const decision: OperatorPolicyKind = reason === "ALLOW" ? "allow" : reason.startsWith("DENY_") ? "deny" : "unavailable";
  return {
    decision,
    reason,
    userMessage: USER_POLICY_MESSAGES[reason],
    httpStatus:
      reason === "ALLOW"
        ? 200
        : decision === "deny" || reason === "UNAVAILABLE_WALLET_MISSING" || reason === "UNAVAILABLE_WALLET_PROOF"
          ? 403
          : 503,
    policyId: OPERATOR_POLICY_ID,
    disclaimer: OPERATOR_POLICY_DISCLAIMER,
    addressScreen,
    geo,
  };
}

export function evaluateOperatorPolicy(input: {
  addressScreen: AddressScreenResult;
  geo: GeoPolicyResult;
}): OperatorPolicyDecision {
  const address = input.addressScreen;
  const geo = input.geo;

  if (address.decision === "blocked") {
    return finish("DENY_ADDRESS_BLOCKED", address, geo);
  }
  if (geo.decision === "DENY") {
    return finish("DENY_GEO_BLOCKED", address, geo);
  }
  if (address.decision === "unavailable") {
    const mapped = address.reason ? ADDRESS_UNAVAILABLE_REASON[address.reason] : undefined;
    if (mapped) return finish(mapped, address, geo);
    if (address.freshness === "stale") return finish("UNAVAILABLE_DATASET_STALE", address, geo);
    if (address.freshness === "missing") return finish("UNAVAILABLE_DATASET_MISSING", address, geo);
    return finish("UNAVAILABLE_ADDRESS_SCREEN", address, geo);
  }
  if (geo.decision === "UNKNOWN") {
    return finish("UNAVAILABLE_GEO_POLICY", address, geo);
  }
  if (address.decision === "clear" && geo.decision === "ALLOW") {
    return finish("ALLOW", address, geo);
  }
  return finish("UNAVAILABLE_POLICY_REQUIRED", address, geo);
}

export function publicPolicyBody(decision: OperatorPolicyDecision, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: false,
    error: decision.userMessage,
    reason: decision.reason,
    decision: decision.decision,
    policy: decision.policyId,
    disclaimer: decision.disclaimer,
    ...extra,
  };
}
