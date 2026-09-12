import { evaluateOperatorPolicy } from "./operator-policy-evaluate.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const clear = { decision: "clear" as const, freshness: "current" as const };
const blocked = { decision: "blocked" as const, freshness: "current" as const };
const missing = { decision: "unavailable" as const, reason: "missing_dataset", freshness: "missing" as const };
const geoAllow = { decision: "ALLOW" as const, reason: "ALLOW_JURISDICTION_NOT_LISTED" };
const geoDeny = { decision: "DENY" as const, reason: "DENY_COMPREHENSIVE_JURISDICTION" };
const geoUnknown = { decision: "UNKNOWN" as const, reason: "UNKNOWN_MISSING_GEO" };

{
  const allow = evaluateOperatorPolicy({ addressScreen: clear, geo: geoAllow });
  assert(allow.reason === "ALLOW" && allow.httpStatus === 200, "allow");
}

{
  const deny = evaluateOperatorPolicy({ addressScreen: blocked, geo: geoAllow });
  assert(deny.reason === "DENY_ADDRESS_BLOCKED" && deny.httpStatus === 403, "address blocked");
}

{
  const deny = evaluateOperatorPolicy({ addressScreen: blocked, geo: geoUnknown });
  assert(deny.reason === "DENY_ADDRESS_BLOCKED", "blocked wins over geo unknown");
}

{
  const deny = evaluateOperatorPolicy({ addressScreen: clear, geo: geoDeny });
  assert(deny.reason === "DENY_GEO_BLOCKED" && deny.httpStatus === 403, "geo deny");
}

{
  const miss = evaluateOperatorPolicy({ addressScreen: missing, geo: geoAllow });
  assert(miss.reason === "UNAVAILABLE_DATASET_MISSING" && miss.httpStatus === 503, "dataset missing");
}

{
  const geo = evaluateOperatorPolicy({ addressScreen: clear, geo: geoUnknown });
  assert(geo.reason === "UNAVAILABLE_GEO_POLICY" && geo.httpStatus === 503, "geo unknown");
}

{
  const wallet = evaluateOperatorPolicy({
    addressScreen: { decision: "unavailable", reason: "wallet_missing", freshness: "missing" },
    geo: geoAllow,
  });
  assert(wallet.reason === "UNAVAILABLE_WALLET_MISSING" && wallet.httpStatus === 403, "wallet missing");
}

console.log("operator-policy-evaluate ok");
