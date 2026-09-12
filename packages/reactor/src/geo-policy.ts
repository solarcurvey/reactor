/**
 * Server-side geo policy interface (issue #63).
 *
 * Decisions are ALLOW / DENY / UNKNOWN with stable reason codes.
 * This module does not enforce HTTP gates (issue #62), screen addresses
 * (issue #61), write ops runbooks (issue #64), or render UX (issue #65).
 *
 * It is not a legal opinion and does not claim OFAC compliance.
 */

export type GeoDecision = "ALLOW" | "DENY" | "UNKNOWN";

export type GeoReasonCode =
  | "ALLOW_JURISDICTION_NOT_LISTED"
  | "DENY_COMPREHENSIVE_JURISDICTION"
  | "DENY_COMPREHENSIVE_REGION"
  | "UNKNOWN_UNTRUSTED_SOURCE"
  | "UNKNOWN_MISSING_GEO"
  | "UNKNOWN_REGION_METADATA_UNAVAILABLE"
  | "UNKNOWN_ANONYMIZER_UNLOCATED"
  | "UNKNOWN_INVALID_CLAIM"
  | "UNKNOWN_STALE_CLAIM"
  | "UNKNOWN_POLICY_INACTIVE";

export type GeoClaimSource = "deployment_edge" | "verified_reverse_proxy" | "fixture";

export type AnonymizerKind = "none" | "proxy" | "tor" | "vpn" | "unknown";

export type AnonymizerAssessment = {
  suspected: boolean;
  kind: AnonymizerKind;
  /** VPN/proxy/Tor signals are never treated as certain. */
  confidence: "best_effort";
};

export type TrustedGeoClaim = {
  source: GeoClaimSource;
  country?: string;
  region?: string;
  regionName?: string;
  clientIp?: string;
  anonymizer: AnonymizerAssessment;
  observedAtMs: number;
};

export type GeoPolicyKind = "fixture" | "production";

export type GeoPolicySourceRef = {
  publisher?: string;
  title: string;
  url: string;
  retrieved: string;
};

export type GeoDeniedJurisdiction = {
  iso2: string;
  name: string;
  program?: string;
  citation?: string;
  url?: string;
};

export type GeoDeniedRegion = {
  country: string;
  iso3166_2: string;
  name: string;
  aliases?: string[];
  program?: string;
  citation?: string;
  url?: string;
};

export type GeoProgramStatusNote = {
  iso2: string;
  name: string;
  status: "not_comprehensive";
  effectiveDate: string;
  citation: string;
  url: string;
  note: string;
};

export type GeoDenyPolicy = {
  kind: GeoPolicyKind;
  policyId: string;
  revision: number;
  schemaVersion: number;
  effectiveDate: string;
  source: GeoPolicySourceRef;
  disclaimer: string;
  /** Jurisdictions that are not comprehensively embargoed; listed so they are not re-added as geo-denies. */
  programNotes?: GeoProgramStatusNote[];
  jurisdictions: GeoDeniedJurisdiction[];
  regions: GeoDeniedRegion[];
};

export type GeoPolicyMatch = {
  kind: "jurisdiction" | "region";
  code: string;
  name: string;
};

export type GeoPolicyDecision = {
  decision: GeoDecision;
  reason: GeoReasonCode;
  policyId: string;
  policyRevision: number;
  policyKind: GeoPolicyKind;
  policyEffectiveDate: string;
  sourceRef: GeoPolicySourceRef;
  matched?: GeoPolicyMatch;
  anonymizer: AnonymizerAssessment;
  country?: string;
  region?: string;
};

export const NONE_ANONYMIZER: AnonymizerAssessment = {
  suspected: false,
  kind: "none",
  confidence: "best_effort",
};

export const FIXTURE_GEO_POLICY: GeoDenyPolicy = {
  kind: "fixture",
  policyId: "local-geo-fixture",
  revision: 1,
  schemaVersion: 1,
  effectiveDate: "1970-01-01",
  source: {
    title: "Local/test fixture — not a sanctions list",
    url: "",
    retrieved: "1970-01-01",
  },
  disclaimer:
    "Deterministic local/test deny codes only. Not a U.S. sanctions list. Not for production.",
  jurisdictions: [{ iso2: "FX", name: "Fixture Deniedland" }],
  regions: [
    {
      country: "FY",
      iso3166_2: "FY-99",
      name: "Fixture restricted region",
      aliases: ["FixtureRegion"],
    },
  ],
};

const CF_SPECIAL_COUNTRY = new Set(["T1", "A1", "A2", "XX", "T2"]);

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeIso2(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toUpperCase();
  if (!t) return undefined;
  if (t.length !== 2) return undefined;
  if (!/^[A-Z0-9]{2}$/.test(t)) return undefined;
  return t;
}

export function normalizeIso3166_2(country: string | undefined, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toUpperCase().replace(/_/g, "-");
  if (!t) return undefined;
  if (/^[A-Z]{2}-[A-Z0-9]{1,4}$/.test(t)) return t;
  if (country && /^[A-Z0-9]{1,4}$/.test(t)) return `${country}-${t}`;
  return undefined;
}

export function createFixtureClaim(partial: {
  country?: string;
  region?: string;
  regionName?: string;
  clientIp?: string;
  anonymizer?: Partial<AnonymizerAssessment>;
  observedAtMs?: number;
}): TrustedGeoClaim {
  return {
    source: "fixture",
    country: partial.country,
    region: partial.region,
    regionName: partial.regionName,
    clientIp: partial.clientIp,
    anonymizer: {
      ...NONE_ANONYMIZER,
      ...partial.anonymizer,
      confidence: "best_effort",
    },
    observedAtMs: partial.observedAtMs ?? 0,
  };
}

function unknownDecision(
  policy: GeoDenyPolicy,
  reason: GeoReasonCode,
  extra: Partial<GeoPolicyDecision> = {},
): GeoPolicyDecision {
  return {
    decision: "UNKNOWN",
    reason,
    policyId: policy.policyId,
    policyRevision: policy.revision,
    policyKind: policy.kind,
    policyEffectiveDate: policy.effectiveDate,
    sourceRef: policy.source,
    anonymizer: extra.anonymizer ?? NONE_ANONYMIZER,
    country: extra.country,
    region: extra.region,
    matched: extra.matched,
  };
}

function specialCountryToClaim(code: string, anonymizer: AnonymizerAssessment): {
  country?: string;
  anonymizer: AnonymizerAssessment;
  unlocated: boolean;
} {
  if (code === "T1") {
    return {
      anonymizer: { suspected: true, kind: "tor", confidence: "best_effort" },
      unlocated: true,
    };
  }
  if (code === "A1") {
    return {
      anonymizer: { suspected: true, kind: "proxy", confidence: "best_effort" },
      unlocated: true,
    };
  }
  if (code === "T2" || code === "A2" || code === "XX") {
    return { anonymizer, unlocated: true };
  }
  return { country: code, anonymizer, unlocated: false };
}

function jurisdictionByIso(policy: GeoDenyPolicy, iso2: string): GeoDeniedJurisdiction | undefined {
  return policy.jurisdictions.find((j) => j.iso2.toUpperCase() === iso2);
}

function countriesWithRegionRules(policy: GeoDenyPolicy): Set<string> {
  return new Set(policy.regions.map((r) => r.country.toUpperCase()));
}

function matchDeniedRegion(
  policy: GeoDenyPolicy,
  country: string | undefined,
  regionCode: string | undefined,
  regionName: string | undefined,
): GeoDeniedRegion | undefined {
  const nameFold = regionName ? fold(regionName) : "";
  for (const row of policy.regions) {
    const iso = row.iso3166_2.toUpperCase();
    if (regionCode && regionCode === iso) return row;
    if (country && regionCode && regionCode === `${country}-${iso.split("-")[1]}`) return row;
    const aliases = [row.name, ...(row.aliases ?? [])].map(fold);
    if (nameFold && aliases.includes(nameFold)) return row;
    if (regionCode && aliases.includes(fold(regionCode))) return row;
  }
  return undefined;
}

/**
 * Evaluate a trusted geo claim against one policy revision.
 * Callers must not pass browser-supplied headers here — only verified claims.
 */
export function evaluateGeoPolicy(
  claim: TrustedGeoClaim | null | undefined,
  policy: GeoDenyPolicy,
  opts?: { missing?: "none" | "untrusted" | "invalid" | "stale" | "inactive" },
): GeoPolicyDecision {
  if (opts?.missing === "inactive") return unknownDecision(policy, "UNKNOWN_POLICY_INACTIVE");
  if (opts?.missing === "untrusted") return unknownDecision(policy, "UNKNOWN_UNTRUSTED_SOURCE");
  if (opts?.missing === "invalid") return unknownDecision(policy, "UNKNOWN_INVALID_CLAIM");
  if (opts?.missing === "stale") return unknownDecision(policy, "UNKNOWN_STALE_CLAIM");
  if (!claim) return unknownDecision(policy, "UNKNOWN_MISSING_GEO");

  const anonymizer: AnonymizerAssessment = {
    suspected: claim.anonymizer.suspected,
    kind: claim.anonymizer.kind,
    confidence: "best_effort",
  };

  let country = normalizeIso2(claim.country);
  if (country && CF_SPECIAL_COUNTRY.has(country)) {
    const mapped = specialCountryToClaim(country, anonymizer);
    country = mapped.country;
    anonymizer.kind = mapped.anonymizer.kind;
    anonymizer.suspected = mapped.anonymizer.suspected;
    if (mapped.unlocated) {
      return unknownDecision(policy, "UNKNOWN_ANONYMIZER_UNLOCATED", {
        anonymizer,
        country: undefined,
        region: claim.region,
      });
    }
  }

  if (claim.country && !country && !CF_SPECIAL_COUNTRY.has(claim.country.trim().toUpperCase())) {
    return unknownDecision(policy, "UNKNOWN_INVALID_CLAIM", { anonymizer });
  }

  const regionCode = normalizeIso3166_2(country, claim.region);
  const regionName = claim.regionName?.trim() || undefined;
  const deniedRegion = matchDeniedRegion(policy, country, regionCode, regionName ?? claim.region);

  if (country) {
    const deniedCountry = jurisdictionByIso(policy, country);
    if (deniedCountry) {
      return {
        decision: "DENY",
        reason: "DENY_COMPREHENSIVE_JURISDICTION",
        policyId: policy.policyId,
        policyRevision: policy.revision,
        policyKind: policy.kind,
        policyEffectiveDate: policy.effectiveDate,
        sourceRef: policy.source,
        matched: { kind: "jurisdiction", code: deniedCountry.iso2, name: deniedCountry.name },
        anonymizer,
        country,
        region: regionCode,
      };
    }
  }

  if (deniedRegion) {
    return {
      decision: "DENY",
      reason: "DENY_COMPREHENSIVE_REGION",
      policyId: policy.policyId,
      policyRevision: policy.revision,
      policyKind: policy.kind,
      policyEffectiveDate: policy.effectiveDate,
      sourceRef: policy.source,
      matched: { kind: "region", code: deniedRegion.iso3166_2, name: deniedRegion.name },
      anonymizer,
      country,
      region: regionCode ?? deniedRegion.iso3166_2,
    };
  }

  if (country && countriesWithRegionRules(policy).has(country)) {
    const hasUsableRegion = Boolean(regionCode || regionName);
    if (!hasUsableRegion) {
      return unknownDecision(policy, "UNKNOWN_REGION_METADATA_UNAVAILABLE", {
        anonymizer,
        country,
      });
    }
    if (!regionCode && regionName) {
      return unknownDecision(policy, "UNKNOWN_REGION_METADATA_UNAVAILABLE", {
        anonymizer,
        country,
        region: regionName,
      });
    }
  }

  if (!country) {
    if (anonymizer.suspected) {
      return unknownDecision(policy, "UNKNOWN_ANONYMIZER_UNLOCATED", { anonymizer });
    }
    return unknownDecision(policy, "UNKNOWN_MISSING_GEO", { anonymizer });
  }

  return {
    decision: "ALLOW",
    reason: "ALLOW_JURISDICTION_NOT_LISTED",
    policyId: policy.policyId,
    policyRevision: policy.revision,
    policyKind: policy.kind,
    policyEffectiveDate: policy.effectiveDate,
    sourceRef: policy.source,
    anonymizer,
    country,
    region: regionCode,
  };
}

export function policyJurisdictionCodes(policy: GeoDenyPolicy): string[] {
  return policy.jurisdictions.map((j) => j.iso2.toUpperCase()).sort();
}

export function policyRegionCodes(policy: GeoDenyPolicy): string[] {
  return policy.regions.map((r) => r.iso3166_2.toUpperCase()).sort();
}
