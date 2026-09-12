/**
 * Env-aware geo policy loader (issue #63).
 *
 * LOCAL / unset-demo always receive the fixture policy. Production deny
 * revisions cannot activate there, including via GEO_DENY_* env dumps.
 * Production-like envs load the versioned comprehensive-sanctions file.
 */
import { productionHardGatesApply } from "./prod-gates.ts";
import {
  FIXTURE_GEO_POLICY,
  evaluateGeoPolicy,
  type GeoDenyPolicy,
  type GeoPolicyDecision,
} from "../../../packages/reactor/src/geo-policy.ts";
import { readTrustedGeo, type HeaderMap } from "./geo-edge.ts";
import productionV1 from "../config/geo-policy-us-comprehensive.v1.json" with { type: "json" };

export const PRODUCTION_GEO_POLICY_V1 = productionV1 as GeoDenyPolicy;

export function assertGeoPolicyShape(policy: GeoDenyPolicy): void {
  if (policy.kind !== "fixture" && policy.kind !== "production") {
    throw new Error("GEO_POLICY: kind must be fixture|production");
  }
  if (!policy.policyId || !Number.isInteger(policy.revision) || policy.revision < 1) {
    throw new Error("GEO_POLICY: policyId/revision required");
  }
  if (!policy.effectiveDate || !policy.source?.title || !policy.source?.retrieved) {
    throw new Error("GEO_POLICY: source + effectiveDate required");
  }
  if (!Array.isArray(policy.jurisdictions) || !Array.isArray(policy.regions)) {
    throw new Error("GEO_POLICY: jurisdictions/regions arrays required");
  }
  for (const j of policy.jurisdictions) {
    if (!/^[A-Z]{2}$/.test(j.iso2)) throw new Error(`GEO_POLICY: bad jurisdiction ${j.iso2}`);
  }
  for (const r of policy.regions) {
    if (!/^[A-Z]{2}$/.test(r.country) || !/^[A-Z]{2}-[A-Z0-9]{1,4}$/.test(r.iso3166_2)) {
      throw new Error(`GEO_POLICY: bad region ${r.iso3166_2}`);
    }
  }
}

assertGeoPolicyShape(PRODUCTION_GEO_POLICY_V1);
assertGeoPolicyShape(FIXTURE_GEO_POLICY);

/** Production ISO codes — used only to prove LOCAL never loads them. */
export const PRODUCTION_JURISDICTION_ISOS = PRODUCTION_GEO_POLICY_V1.jurisdictions.map((j) => j.iso2);

export function resolveActiveGeoPolicy(env: NodeJS.ProcessEnv = process.env): GeoDenyPolicy {
  if (!productionHardGatesApply(env)) {
    return FIXTURE_GEO_POLICY;
  }
  return PRODUCTION_GEO_POLICY_V1;
}

export function geoPolicyIsActive(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!productionHardGatesApply(env)) return true;
  return (env.GEO_POLICY_ACTIVE ?? "1").trim() !== "0";
}

/**
 * One server-side entry: trusted edge claim + active policy → decision.
 * Does not throw, does not write HTTP status — callers (#62) decide enforcement.
 */
export function evaluateRequestGeo(
  headers: HeaderMap,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): GeoPolicyDecision {
  const policy = resolveActiveGeoPolicy(env);
  if (!geoPolicyIsActive(env)) {
    return evaluateGeoPolicy(null, policy, { missing: "inactive" });
  }
  const trust = readTrustedGeo(headers, env, nowMs);
  if (trust.ok) return evaluateGeoPolicy(trust.claim, policy);
  return evaluateGeoPolicy(null, policy, {
    missing: trust.missing === "missing" ? undefined : trust.missing,
  });
}
