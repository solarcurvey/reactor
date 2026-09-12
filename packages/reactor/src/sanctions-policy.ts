/**
 * Canonical REACTOR-operated sanctions / geo policy decision (issue #62).
 *
 * One module. Routes must not invent their own allow/deny logic.
 * Inputs are already-evaluated address-screen and trusted-geo results
 * (#61 / #63 plug in here). This module does not parse OFAC XML, does
 * not read browser country headers, and does not sign or upload.
 *
 * Fail closed: blocked OR required-policy unavailable/stale → not allow.
 * Public immutable contracts cannot be blocked from direct onchain use.
 * This gate applies only to REACTOR-operated write / authorization services.
 *
 * Not a legal opinion. Not OFAC / sanctions “compliance.”
 */

export const OPERATOR_POLICY_ID = "reactor-operator-policy-v1";

export const OPERATOR_POLICY_DISCLAIMER =
  "REACTOR-operated services only. Public contracts remain callable onchain. Not a legal or OFAC-compliance opinion.";

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

export type OperatorPolicyKind = "allow" | "deny" | "unavailable";

export type OperatorPolicyReason =
  | "ALLOW"
  | "DENY_ADDRESS_BLOCKED"
  | "DENY_GEO_BLOCKED"
  | "UNAVAILABLE_DATASET_MISSING"
  | "UNAVAILABLE_DATASET_STALE"
  | "UNAVAILABLE_ADDRESS_SCREEN"
  | "UNAVAILABLE_GEO_POLICY"
  | "UNAVAILABLE_WALLET_MISSING"
  | "UNAVAILABLE_WALLET_PROOF"
  | "UNAVAILABLE_POLICY_REQUIRED";

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

export const USER_POLICY_MESSAGES: Record<OperatorPolicyReason, string> = {
  ALLOW: "",
  DENY_ADDRESS_BLOCKED: "This wallet cannot use REACTOR-operated services.",
  DENY_GEO_BLOCKED: "REACTOR-operated services are not available from this location.",
  UNAVAILABLE_DATASET_MISSING: "Required compliance checks are temporarily unavailable.",
  UNAVAILABLE_DATASET_STALE: "Required compliance checks are temporarily unavailable.",
  UNAVAILABLE_ADDRESS_SCREEN: "Required compliance checks are temporarily unavailable.",
  UNAVAILABLE_GEO_POLICY: "Required compliance checks are temporarily unavailable.",
  UNAVAILABLE_WALLET_MISSING: "A signed wallet proof is required for this action.",
  UNAVAILABLE_WALLET_PROOF: "A signed wallet proof is required for this action.",
  UNAVAILABLE_POLICY_REQUIRED: "Required compliance checks are temporarily unavailable.",
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

/**
 * Combine canonical address-screen + trusted-geo results.
 * Blocked wins over unavailable. Address block is checked before geo block.
 * Clear + ALLOW is the only allow path.
 */
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

/** Coarse UX kind for #65. Distinguishes wallet / geo / temporary without leaking internals. */
export type OperatorPolicyUxKind = "allow" | "wallet" | "geo" | "unavailable";

export function uxKindForReason(reason: OperatorPolicyReason): OperatorPolicyUxKind {
  if (reason === "ALLOW") return "allow";
  if (reason === "DENY_ADDRESS_BLOCKED") return "wallet";
  if (reason === "DENY_GEO_BLOCKED") return "geo";
  return "unavailable";
}

/**
 * Minimized public decision for `GET /operator-policy/status` (#65 / PR #75).
 * Same machine `reason` as write-path denials. No wallet, IP, country, SDN, or dataset fields.
 */
export function publicStatusView(decision: OperatorPolicyDecision): Record<string, unknown> {
  return {
    ok: decision.reason === "ALLOW",
    decision: decision.decision,
    reason: decision.reason,
    kind: uxKindForReason(decision.reason),
    error: decision.userMessage,
    disclaimer: decision.disclaimer,
    policy: decision.policyId,
    writesAllowed: decision.reason === "ALLOW",
    source: "indexer",
  };
}

/** EVM 20-byte identity. Checksum casing does not matter. */
export function normalizeEvmAddress(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(t)) return undefined;
  return t.toLowerCase();
}
