import {
  FIXTURE_GEO_POLICY,
  createFixtureClaim,
  evaluateGeoPolicy,
  normalizeIso2,
  normalizeIso3166_2,
  policyJurisdictionCodes,
  type GeoDenyPolicy,
} from "./geo-policy.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const prodLike: GeoDenyPolicy = {
  kind: "production",
  policyId: "us-comprehensive-sanctions",
  revision: 1,
  schemaVersion: 1,
  effectiveDate: "2026-09-12",
  source: {
    publisher: "OFAC",
    title: "Sanctions Programs and Country Information",
    url: "https://ofac.treasury.gov/sanctions-programs-and-country-information",
    retrieved: "2026-09-12",
  },
  disclaimer: "Test double of revision 1. Not a legal opinion.",
  jurisdictions: [
    { iso2: "CU", name: "Cuba" },
    { iso2: "IR", name: "Iran" },
    { iso2: "KP", name: "North Korea" },
    { iso2: "SY", name: "Syria" },
  ],
  regions: [
    { country: "UA", iso3166_2: "UA-43", name: "Crimea", aliases: ["Krym"] },
    { country: "UA", iso3166_2: "UA-40", name: "Sevastopol" },
    { country: "UA", iso3166_2: "UA-14", name: "Donetsk", aliases: ["DNR"] },
    { country: "UA", iso3166_2: "UA-09", name: "Luhansk", aliases: ["Lugansk", "LNR"] },
  ],
};

assert(normalizeIso2(" ir ") === "IR", "iso2 trim");
assert(normalizeIso2("IRA") === undefined, "iso2 length");
assert(normalizeIso3166_2("UA", "43") === "UA-43", "region prepend");
assert(normalizeIso3166_2("UA", "ua-14") === "UA-14", "region case");

{
  const d = evaluateGeoPolicy(null, prodLike);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_MISSING_GEO", "null claim");
}

{
  const d = evaluateGeoPolicy(null, prodLike, { missing: "untrusted" });
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_UNTRUSTED_SOURCE", "untrusted");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "US" }), prodLike);
  assert(d.decision === "ALLOW" && d.reason === "ALLOW_JURISDICTION_NOT_LISTED", "US allow");
  assert(d.country === "US", "US country");
}

for (const iso of ["CU", "IR", "KP", "SY"]) {
  const d = evaluateGeoPolicy(createFixtureClaim({ country: iso }), prodLike);
  assert(d.decision === "DENY" && d.reason === "DENY_COMPREHENSIVE_JURISDICTION", `${iso} deny`);
  assert(d.matched?.code === iso, `${iso} match`);
  assert(d.policyRevision === 1 && d.policyEffectiveDate === "2026-09-12", `${iso} revision`);
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "UA", region: "UA-43" }), prodLike);
  assert(d.decision === "DENY" && d.reason === "DENY_COMPREHENSIVE_REGION", "Crimea code");
  assert(d.matched?.code === "UA-43", "Crimea match");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "UA", regionName: "Crimea" }), prodLike);
  assert(d.decision === "DENY" && d.reason === "DENY_COMPREHENSIVE_REGION", "Crimea alias");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "RU", regionName: "Sevastopol" }), prodLike);
  assert(d.decision === "DENY" && d.reason === "DENY_COMPREHENSIVE_REGION", "Sevastopol via RU provider");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "UA" }), prodLike);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_REGION_METADATA_UNAVAILABLE", "UA no region");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "UA", region: "UA-32" }), prodLike);
  assert(d.decision === "ALLOW", "Kyiv oblast allow");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "RU" }), prodLike);
  assert(d.decision === "ALLOW", "RU country not comprehensive");
}

{
  const d = evaluateGeoPolicy(
    createFixtureClaim({
      country: "US",
      anonymizer: { suspected: true, kind: "vpn", confidence: "best_effort" },
    }),
    prodLike,
  );
  assert(d.decision === "ALLOW", "VPN does not invent deny");
  assert(d.anonymizer.suspected && d.anonymizer.confidence === "best_effort", "VPN best-effort");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "T1" }), prodLike);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_ANONYMIZER_UNLOCATED", "Tor T1");
  assert(d.anonymizer.kind === "tor" && d.anonymizer.confidence === "best_effort", "Tor best-effort");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "A1" }), prodLike);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_ANONYMIZER_UNLOCATED", "anon proxy");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "ZZZ" as unknown as string }), prodLike);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_INVALID_CLAIM", "bad country");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "US" }), FIXTURE_GEO_POLICY);
  assert(d.decision === "ALLOW", "fixture US");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "FX" }), FIXTURE_GEO_POLICY);
  assert(d.decision === "DENY" && d.reason === "DENY_COMPREHENSIVE_JURISDICTION", "fixture FX");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "IR" }), FIXTURE_GEO_POLICY);
  assert(d.decision === "ALLOW", "fixture must not deny IR");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "FY" }), FIXTURE_GEO_POLICY);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_REGION_METADATA_UNAVAILABLE", "fixture FY");
}

{
  const d = evaluateGeoPolicy(createFixtureClaim({ country: "FY", region: "FY-99" }), FIXTURE_GEO_POLICY);
  assert(d.decision === "DENY" && d.reason === "DENY_COMPREHENSIVE_REGION", "fixture region");
}

{
  const codes = policyJurisdictionCodes(FIXTURE_GEO_POLICY);
  for (const iso of ["CU", "IR", "KP", "SY"]) {
    assert(!codes.includes(iso), `fixture excludes production ${iso}`);
  }
}

console.log("geo-policy unit tests ok");
