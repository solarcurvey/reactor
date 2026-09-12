/** Interface-compatible #63 plugin fixture for loader tests. */
export function evaluateRequestGeo(
  headers: Record<string, string | string[] | undefined>,
  _env?: NodeJS.ProcessEnv,
) {
  void _env;
  const raw = headers["x-reactor-geo-fixture"] ?? headers["X-Reactor-Geo-Fixture"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const country = String(v ?? "").trim().toUpperCase();
  if (country === "FX") return { decision: "DENY" as const, reason: "DENY_COMPREHENSIVE_JURISDICTION" };
  if (country === "US" || country === "ZZ") return { decision: "ALLOW" as const, reason: "ALLOW_JURISDICTION_NOT_LISTED" };
  return { decision: "UNKNOWN" as const, reason: "UNKNOWN_MISSING_GEO" };
}
