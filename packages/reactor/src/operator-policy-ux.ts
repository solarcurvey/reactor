/**
 * Public REACTOR-operated access decision for launchpad UX (issue #65).
 *
 * Machine reason codes match the #62 / PR #68 `evaluateOperatorPolicy` contract.
 * This module is display + write-CTA gating only. It is not a legal opinion,
 * not OFAC/sanctions “compliance,” and cannot stop permissionless chain reads
 * or direct calls to immutable public contracts.
 *
 * Browser output must never include raw IP, country/region ISO, ASN, SDN names,
 * list UIDs, dataset hashes, HMAC/proof material, or screening-entry metadata.
 */

export const OPERATOR_POLICY_ID = "reactor-operator-policy-v1";

export const OPERATOR_POLICY_DISCLAIMER =
  "REACTOR-operated services only. Public contracts remain callable onchain. Not a legal or OFAC-compliance opinion.";

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

/** Coarse UX variant. Distinguishes wallet / geo / temporary without leaking internals. */
export type RestrictedUxKind = "allow" | "wallet" | "geo" | "unavailable" | "pending";

export const USER_POLICY_MESSAGES: Record<OperatorPolicyReason, string> = {
  ALLOW: "",
  DENY_ADDRESS_BLOCKED: "REACTOR-operated services are not available for this account.",
  DENY_GEO_BLOCKED: "REACTOR-operated services are not available for this request location.",
  UNAVAILABLE_DATASET_MISSING: "Required access checks are temporarily unavailable.",
  UNAVAILABLE_DATASET_STALE: "Required access checks are temporarily unavailable.",
  UNAVAILABLE_ADDRESS_SCREEN: "Required access checks are temporarily unavailable.",
  UNAVAILABLE_GEO_POLICY: "Required access checks are temporarily unavailable.",
  UNAVAILABLE_WALLET_MISSING: "A signed wallet proof is required for this action.",
  UNAVAILABLE_WALLET_PROOF: "A signed wallet proof is required for this action.",
  UNAVAILABLE_POLICY_REQUIRED: "Required access checks are temporarily unavailable.",
};

export const RESTRICTED_PAGE_COPY: Record<Exclude<RestrictedUxKind, "allow" | "pending">, { title: string; lead: string }> =
  {
    wallet: {
      title: "Operated services unavailable",
      lead: "REACTOR-operated services are not available for this account. This is a hosted-service decision. It does not accuse anyone of unlawful conduct.",
    },
    geo: {
      title: "Operated services unavailable",
      lead: "REACTOR-operated services are not available for this request location. This is a hosted-service decision. It does not accuse anyone of unlawful conduct.",
    },
    unavailable: {
      title: "Operated services temporarily unavailable",
      lead: "Required access checks are temporarily unavailable. REACTOR-operated writes are paused until those checks return. This is a hosted-service decision. It does not accuse anyone of unlawful conduct.",
    },
  };

export const RESTRICTED_DISCLOSURE = {
  whatExists: [
    "REACTOR-operated write assistance (launch authorization, quote tickets, uploads, and similar hosted paths) may refuse a request.",
    "Wallet-list screening and geographic restriction are server-side inputs to that hosted decision.",
    "If required checks cannot run, operated writes fail closed (temporarily unavailable).",
  ],
  whatCannot: [
    "These controls cannot stop anyone from reading public chain state.",
    "They cannot stop anyone from calling immutable public contracts directly.",
    "The launchpad UI does not censor permissionless onchain reads.",
    "This is not a protocol pause and not a legal or OFAC-compliance opinion.",
  ],
} as const;

const FORBIDDEN_COPY = [
  "vpn",
  "proxy",
  "tor",
  "circumvent",
  "bypass",
  "unblock",
  "criminal",
  "illegal",
  "terror",
  "sdn name",
  "ofac listed you",
];

export const SENSITIVE_POLICY_KEYS = [
  "ip",
  "clientip",
  "sourceip",
  "remoteip",
  "xforwardedfor",
  "forwarded",
  "trueclientip",
  "cfconnectingip",
  "country",
  "countrycode",
  "region",
  "regioncode",
  "iso",
  "asn",
  "wallet",
  "address",
  "creator",
  "recipient",
  "account",
  "sdn",
  "uid",
  "listid",
  "listuid",
  "datasethash",
  "contenthash",
  "hmac",
  "signature",
  "proof",
  "token",
  "entry",
  "remarks",
  "programs",
  "addressscreen",
  "geo",
  "headers",
  "raw",
] as const;

export type PublicOperatorPolicyView = {
  ok: boolean;
  decision: OperatorPolicyKind;
  reason: OperatorPolicyReason;
  kind: RestrictedUxKind;
  error: string;
  disclaimer: typeof OPERATOR_POLICY_DISCLAIMER;
  policy: typeof OPERATOR_POLICY_ID;
  writesAllowed: boolean;
  source: "indexer" | "stub" | "fixture" | "write-error";
};

export function uxKindForReason(reason: OperatorPolicyReason): RestrictedUxKind {
  if (reason === "ALLOW") return "allow";
  if (reason === "DENY_ADDRESS_BLOCKED") return "wallet";
  if (reason === "DENY_GEO_BLOCKED") return "geo";
  return "unavailable";
}

export function decisionForReason(reason: OperatorPolicyReason): OperatorPolicyKind {
  if (reason === "ALLOW") return "allow";
  if (reason.startsWith("DENY_")) return "deny";
  return "unavailable";
}

export function writesAllowedForReason(reason: OperatorPolicyReason): boolean {
  return reason === "ALLOW";
}

export function isOperatorPolicyReason(value: unknown): value is OperatorPolicyReason {
  return typeof value === "string" && value in USER_POLICY_MESSAGES;
}

/** EVM 20-byte identity. Checksum casing does not matter. */
export function normalizeEvmAddress(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(t)) return undefined;
  return t.toLowerCase();
}

export function parseUxKind(value: unknown): RestrictedUxKind | undefined {
  if (value === "wallet" || value === "geo" || value === "unavailable" || value === "allow" || value === "pending") {
    return value;
  }
  if (isOperatorPolicyReason(value)) return uxKindForReason(value);
  return undefined;
}

export function publicPolicyView(input: {
  reason: OperatorPolicyReason;
  source: PublicOperatorPolicyView["source"];
  error?: string;
}): PublicOperatorPolicyView {
  const reason = input.reason;
  const decision = decisionForReason(reason);
  const kind = uxKindForReason(reason);
  const error = (input.error && input.error.trim()) || USER_POLICY_MESSAGES[reason];
  return {
    ok: reason === "ALLOW",
    decision,
    reason,
    kind,
    error,
    disclaimer: OPERATOR_POLICY_DISCLAIMER,
    policy: OPERATOR_POLICY_ID,
    writesAllowed: writesAllowedForReason(reason),
    source: input.source,
  };
}

export function allowStubView(): PublicOperatorPolicyView {
  return publicPolicyView({ reason: "ALLOW", source: "stub" });
}

export function unavailableStubView(): PublicOperatorPolicyView {
  return publicPolicyView({ reason: "UNAVAILABLE_POLICY_REQUIRED", source: "stub" });
}

/**
 * Drop every field that is not the documented public UX contract.
 * Extra indexer keys (IP, geo internals, screen records) are discarded.
 */
export function sanitizePublicPolicyView(raw: unknown, source: PublicOperatorPolicyView["source"]): PublicOperatorPolicyView | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const reasonRaw = body.reason;
  if (!isOperatorPolicyReason(reasonRaw)) return null;
  const error = typeof body.error === "string" ? body.error : USER_POLICY_MESSAGES[reasonRaw];
  const view = publicPolicyView({ reason: reasonRaw, source, error });
  if (body.decision === "allow" || body.decision === "deny" || body.decision === "unavailable") {
    if (body.decision !== view.decision && reasonRaw !== "ALLOW") {
      /* trust machine reason over a spoofed decision string */
    }
  }
  return view;
}

export function parseWritePolicyError(raw: unknown): PublicOperatorPolicyView | null {
  return sanitizePublicPolicyView(raw, "write-error");
}

export function restrictedHref(kind: RestrictedUxKind): string {
  if (kind === "wallet" || kind === "geo" || kind === "unavailable") return `/restricted?kind=${kind}`;
  return "/restricted";
}

export function writeCtaLabel(kind: RestrictedUxKind, fallback: string): string {
  if (kind === "wallet") return "Account unavailable";
  if (kind === "geo") return "Unavailable here";
  if (kind === "unavailable") return "Temporarily unavailable";
  if (kind === "pending") return fallback;
  return fallback;
}

export function copyContainsForbiddenGuidance(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_COPY.some((needle) => {
    if (needle.length <= 3) {
      return new RegExp(`\\b${needle}\\b`, "i").test(lower);
    }
    return lower.includes(needle);
  });
}

export function publicViewHasSensitiveKeys(view: Record<string, unknown>): string[] {
  const hits: string[] = [];
  for (const key of Object.keys(view)) {
    const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if ((SENSITIVE_POLICY_KEYS as readonly string[]).includes(compact) && !["error", "reason", "kind", "ok"].includes(key)) {
      hits.push(key);
    }
  }
  return hits;
}

export const PUBLIC_POLICY_VIEW_KEYS = [
  "ok",
  "decision",
  "reason",
  "kind",
  "error",
  "disclaimer",
  "policy",
  "writesAllowed",
  "source",
] as const;
