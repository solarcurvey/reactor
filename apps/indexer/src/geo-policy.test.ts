import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { productionHardGatesApply } from "./prod-gates.ts";
import { readTrustedGeo, signGeoClaim, UNTRUSTED_GEO_HEADER_NAMES } from "./geo-edge.ts";
import {
  PRODUCTION_GEO_POLICY_V1,
  PRODUCTION_JURISDICTION_ISOS,
  evaluateRequestGeo,
  resolveActiveGeoPolicy,
} from "./geo-policy-resolve.ts";
import { FIXTURE_GEO_POLICY, policyJurisdictionCodes } from "../../../packages/reactor/src/geo-policy.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SECRET = "geo-edge-secret-ok!!";
const NOW = 1_778_000_000_000;
const TS = String(Math.floor(NOW / 1000));

function signed(parts: {
  country: string;
  region?: string;
  regionName?: string;
  anonymizer?: string;
  ip?: string;
  ts?: string;
}) {
  const ts = parts.ts ?? TS;
  const country = parts.country;
  const region = parts.region ?? "";
  const regionName = parts.regionName ?? "";
  const anonymizer = parts.anonymizer ?? "none";
  const ip = parts.ip ?? "203.0.113.10";
  const mac = signGeoClaim(SECRET, { ts, country, region, regionName, anonymizer, ip });
  const headers: Record<string, string> = {
    "x-reactor-geo-ts": ts,
    "x-reactor-geo-country": country,
    "x-reactor-geo-region": region,
    "x-reactor-geo-anonymizer": anonymizer,
    "x-reactor-geo-ip": ip,
    "x-reactor-geo-mac": mac,
  };
  if (regionName) headers["x-reactor-geo-region-name"] = regionName;
  return headers;
}

const localEnv = { REACTOR_ENV: "LOCAL" } as NodeJS.ProcessEnv;
const prodEnv = {
  REACTOR_ENV: "PROD",
  GEO_EDGE_SECRET: SECRET,
} as NodeJS.ProcessEnv;

assert(!productionHardGatesApply(localEnv), "local env");
assert(productionHardGatesApply(prodEnv), "prod env");

{
  const p = resolveActiveGeoPolicy(localEnv);
  assert(p.kind === "fixture" && p.policyId === FIXTURE_GEO_POLICY.policyId, "LOCAL uses fixture");
  const codes = policyJurisdictionCodes(p);
  for (const iso of PRODUCTION_JURISDICTION_ISOS) {
    assert(!codes.includes(iso), `LOCAL must not load production ${iso}`);
  }
}

{
  const poisoned = {
    REACTOR_ENV: "LOCAL",
    GEO_POLICY_KIND: "production",
    GEO_DENY_COUNTRIES: "CU,IR,KP,SY",
    GEO_POLICY_PATH: "/tmp/evil.json",
  } as NodeJS.ProcessEnv;
  const p = resolveActiveGeoPolicy(poisoned);
  assert(p.kind === "fixture", "LOCAL ignores GEO_DENY / kind overrides");
  assert(evaluateRequestGeo({ "cf-ipcountry": "IR", "x-country": "IR" }, poisoned).decision === "UNKNOWN", "LOCAL ignores spoofed IR");
  assert(evaluateRequestGeo({ "x-reactor-geo-fixture": "IR" }, poisoned).decision === "ALLOW", "LOCAL fixture IR is not denied");
  assert(evaluateRequestGeo({ "x-reactor-geo-fixture": "FX" }, poisoned).decision === "DENY", "LOCAL fixture FX denied");
}

{
  const p = resolveActiveGeoPolicy(prodEnv);
  assert(p.kind === "production" && p.revision === 3, "PROD loads revision 3");
  assert(p.effectiveDate === "2026-09-12", "PROD effective date");
  assert(p.source.url.includes("ofac.treasury.gov"), "PROD source url");
  assert(p.disclaimer.toLowerCase().includes("not a legal opinion"), "disclaimer");
  assert(!p.disclaimer.toLowerCase().includes("we are ofac compliant"), "no compliance claim");
  assert(!p.jurisdictions.some((j) => j.iso2 === "SY"), "SY not in comprehensive deny set");
  assert(
    p.programNotes?.some((n) => n.iso2 === "SY" && n.status === "not_comprehensive" && n.effectiveDate === "2025-07-01"),
    "SY program status recorded",
  );
}

{
  const d = evaluateRequestGeo({ "cf-ipcountry": "IR", "x-vercel-ip-country": "IR" }, prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_UNTRUSTED_SOURCE", "PROD ignores browser country headers");
}

{
  const d = evaluateRequestGeo(signed({ country: "IR" }), prodEnv, NOW);
  assert(d.decision === "DENY" && d.reason === "DENY_COMPREHENSIVE_JURISDICTION", "PROD signed IR");
  assert(d.matched?.code === "IR", "IR match");
}

{
  const d = evaluateRequestGeo(signed({ country: "US" }), prodEnv, NOW);
  assert(d.decision === "ALLOW", "PROD signed US");
}

{
  const d = evaluateRequestGeo(signed({ country: "SY" }), prodEnv, NOW);
  assert(d.decision === "ALLOW" && d.reason === "ALLOW_JURISDICTION_NOT_LISTED", "clear SY geo is not blanket-denied");
  assert(d.matched === undefined, "SY has no deny match");
  assert(d.country === "SY", "SY country preserved");
  const sy = PRODUCTION_GEO_POLICY_V1.programNotes?.find((n) => n.iso2 === "SY");
  assert(sy?.status === "not_comprehensive", "SY remaining program is not comprehensive");
  assert(sy?.note.includes("#61") && sy.note.includes("#62"), "list-based Syrian screening stays #61 + #62");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", region: "UA-14" }), prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_REGION_METADATA_UNAVAILABLE", "UA-14 oblast is not blanket DENY");
  assert(d.matched === undefined, "UA-14 has no deny match");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", region: "UA-09" }), prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_REGION_METADATA_UNAVAILABLE", "UA-09 oblast is not blanket DENY");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", regionName: "Donetsk Oblast" }), prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_REGION_METADATA_UNAVAILABLE", "Donetsk Oblast name insufficient");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", regionName: "Luhansk Oblast" }), prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_REGION_METADATA_UNAVAILABLE", "Luhansk Oblast name insufficient");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", regionName: "Luhansk" }), prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_REGION_METADATA_UNAVAILABLE", "bare Luhansk is oblast-level");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", region: "UA-DPR" }), prodEnv, NOW);
  assert(d.decision === "DENY" && d.reason === "DENY_COMPREHENSIVE_REGION", "precise UA-DPR covered-region code");
  assert(d.matched?.code === "UA-DPR", "DPR code match");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", regionName: "Donetsk People's Republic" }), prodEnv, NOW);
  assert(d.decision === "DENY" && d.matched?.code === "UA-DPR", "precise DPR regionName");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", regionName: "DNR" }), prodEnv, NOW);
  assert(d.decision === "DENY" && d.matched?.code === "UA-DPR", "DNR alias");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA", region: "UA-LPR" }), prodEnv, NOW);
  assert(d.decision === "DENY" && d.matched?.code === "UA-LPR", "precise UA-LPR covered-region code");
}

{
  const forged = signed({ country: "US" });
  forged["x-reactor-geo-region-name"] = "Crimea";
  const d = evaluateRequestGeo(forged, prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_UNTRUSTED_SOURCE", "unsigned region-name is not trusted");
}

{
  const d = evaluateRequestGeo(signed({ country: "UA" }), prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_REGION_METADATA_UNAVAILABLE", "UA without region");
}

{
  const d = evaluateRequestGeo(signed({ country: "US", anonymizer: "suspected_vpn" }), prodEnv, NOW);
  assert(d.decision === "ALLOW", "VPN best-effort does not deny");
  assert(d.anonymizer.kind === "vpn" && d.anonymizer.confidence === "best_effort", "VPN label");
}

{
  const d = evaluateRequestGeo(signed({ country: "T1", anonymizer: "suspected_tor" }), prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_ANONYMIZER_UNLOCATED", "Tor unlocated");
}

{
  const bad = signed({ country: "IR" });
  bad["x-reactor-geo-mac"] = "00".repeat(32);
  const d = evaluateRequestGeo(bad, prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_UNTRUSTED_SOURCE", "bad mac");
}

{
  const stale = signed({ country: "IR", ts: String(Math.floor(NOW / 1000) - 10_000) });
  const d = evaluateRequestGeo(stale, prodEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_STALE_CLAIM", "stale claim");
}

{
  const d = evaluateRequestGeo(signed({ country: "IR" }), { REACTOR_ENV: "PROD" } as NodeJS.ProcessEnv, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_UNTRUSTED_SOURCE", "PROD without edge secret");
}

{
  const d = evaluateRequestGeo(
    { "x-reactor-geo-fixture": "FX", "cf-ipcountry": "US" },
    prodEnv,
    NOW,
  );
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_UNTRUSTED_SOURCE", "PROD rejects fixture header");
}

{
  const compactMac = signGeoClaim(SECRET, {
    ts: TS,
    country: "KP",
    region: "",
    regionName: "",
    anonymizer: "none",
    ip: "",
  });
  const d = evaluateRequestGeo({ "x-reactor-geo": `v1.${TS}.KP..none.${compactMac}` }, prodEnv, NOW);
  assert(d.decision === "DENY" && d.matched?.code === "KP", "compact signed claim");
}

{
  const inactive = { ...prodEnv, GEO_POLICY_ACTIVE: "0" };
  const d = evaluateRequestGeo(signed({ country: "IR" }), inactive, NOW);
  assert(d.decision === "UNKNOWN" && d.reason === "UNKNOWN_POLICY_INACTIVE", "explicit inactive");
}

{
  const trust = readTrustedGeo({ "cf-ipcountry": "IR", "x-forwarded-for": "1.2.3.4" }, prodEnv, NOW);
  assert(!trust.ok && trust.missing === "untrusted", "untrusted headers listed");
  assert(trust.ignored.includes("cf-ipcountry"), "cf ignored");
  for (const n of ["cf-ipcountry", "x-forwarded-for"] as const) {
    assert(UNTRUSTED_GEO_HEADER_NAMES.includes(n), n);
  }
}

{
  assert(PRODUCTION_GEO_POLICY_V1.source.retrieved === "2026-09-12", "retrieved date");
  assert(PRODUCTION_GEO_POLICY_V1.revision === 3, "revision 3 after FAQ 1009 oblast fix");
  assert(PRODUCTION_GEO_POLICY_V1.jurisdictions.length === 3, "three comprehensive countries");
  assert(
    PRODUCTION_GEO_POLICY_V1.jurisdictions.map((j) => j.iso2).sort().join(",") === "CU,IR,KP",
    "deny set is CU IR KP only",
  );
  assert(!PRODUCTION_GEO_POLICY_V1.regions.some((r) => r.iso3166_2 === "UA-14" || r.iso3166_2 === "UA-09"), "oblast codes are not deny keys");
  assert(
    PRODUCTION_GEO_POLICY_V1.insufficientRegions?.map((r) => r.iso3166_2).sort().join(",") === "UA-09,UA-14",
    "oblast codes are insufficient",
  );
  for (const row of PRODUCTION_GEO_POLICY_V1.regions) {
    const labels = [row.name, ...(row.aliases ?? [])];
    for (const label of labels) {
      assert(!/oblast/i.test(label), `${row.iso3166_2} deny label must not be oblast-level: ${label}`);
    }
  }
  assert(PRODUCTION_GEO_POLICY_V1.regions.length === 4, "four precise regions");
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

{
  const webSrc = join(import.meta.dirname, "../../web/src");
  const needles = [
    "evaluateGeoPolicy",
    "evaluateRequestGeo",
    "geo-policy-us-comprehensive",
    "CF-IPCountry",
    "cf-ipcountry",
    "DENY_COMPREHENSIVE_JURISDICTION",
    "x-reactor-geo",
  ];
  for (const file of walk(webSrc)) {
    const text = readFileSync(file, "utf8");
    for (const n of needles) {
      assert(!text.includes(n), `${file} must not contain client geo policy ${n}`);
    }
  }
}

console.log("indexer geo-policy tests ok");
