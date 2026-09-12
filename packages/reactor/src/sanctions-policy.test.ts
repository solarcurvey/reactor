import {
  evaluateOperatorPolicy,
  publicPolicyBody,
  publicStatusView,
  uxKindForReason,
  normalizeEvmAddress,
  USER_POLICY_MESSAGES,
  OPERATOR_POLICY_ID,
  OPERATOR_POLICY_DISCLAIMER,
  type AddressScreenResult,
  type GeoPolicyResult,
} from "./sanctions-policy.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const clear: AddressScreenResult = { decision: "clear", freshness: "current" };
const blocked: AddressScreenResult = { decision: "blocked", freshness: "current" };
const stale: AddressScreenResult = { decision: "unavailable", reason: "stale_dataset", freshness: "stale" };
const missing: AddressScreenResult = { decision: "unavailable", reason: "missing_dataset", freshness: "missing" };
const allowGeo: GeoPolicyResult = { decision: "ALLOW", reason: "ALLOW_JURISDICTION_NOT_LISTED" };
const denyGeo: GeoPolicyResult = { decision: "DENY", reason: "DENY_COMPREHENSIVE_JURISDICTION" };
const unknownGeo: GeoPolicyResult = { decision: "UNKNOWN", reason: "UNKNOWN_MISSING_GEO" };

{
  const d = evaluateOperatorPolicy({ addressScreen: blocked, geo: allowGeo });
  assert(d.decision === "deny" && d.reason === "DENY_ADDRESS_BLOCKED", "blocked wallet + allowed geo => denied");
  assert(d.httpStatus === 403, "blocked wallet is 403");
  assert(d.userMessage === USER_POLICY_MESSAGES.DENY_ADDRESS_BLOCKED, "blocked wallet user copy");
}

{
  const d = evaluateOperatorPolicy({ addressScreen: clear, geo: denyGeo });
  assert(d.decision === "deny" && d.reason === "DENY_GEO_BLOCKED", "clear wallet + blocked geo => denied");
  assert(d.httpStatus === 403, "blocked geo is 403");
}

{
  const d = evaluateOperatorPolicy({ addressScreen: clear, geo: allowGeo });
  assert(d.decision === "allow" && d.reason === "ALLOW", "clear wallet + allowed geo => allowed");
  assert(d.httpStatus === 200, "allow is 200");
  assert(d.userMessage === "", "allow has empty user message");
}

{
  const d = evaluateOperatorPolicy({ addressScreen: stale, geo: allowGeo });
  assert(d.decision === "unavailable" && d.reason === "UNAVAILABLE_DATASET_STALE", "stale dataset => unavailable");
  assert(d.httpStatus === 503, "stale is 503");
}

{
  const d = evaluateOperatorPolicy({ addressScreen: missing, geo: allowGeo });
  assert(d.decision === "unavailable" && d.reason === "UNAVAILABLE_DATASET_MISSING", "missing dataset => unavailable");
  assert(d.httpStatus === 503, "missing is 503");
}

{
  const d = evaluateOperatorPolicy({ addressScreen: clear, geo: unknownGeo });
  assert(d.decision === "unavailable" && d.reason === "UNAVAILABLE_GEO_POLICY", "unknown geo => unavailable");
  assert(d.httpStatus === 503, "unknown geo is 503");
}

{
  const d = evaluateOperatorPolicy({
    addressScreen: { decision: "unavailable", reason: "wallet_missing", freshness: "missing" },
    geo: allowGeo,
  });
  assert(d.reason === "UNAVAILABLE_WALLET_MISSING", "missing wallet maps");
  assert(d.httpStatus === 403, "missing wallet is 403");
}

{
  const d = evaluateOperatorPolicy({
    addressScreen: { decision: "unavailable", reason: "wallet_invalid", freshness: "missing" },
    geo: allowGeo,
  });
  assert(d.reason === "UNAVAILABLE_WALLET_PROOF" && d.httpStatus === 403, "invalid proof maps 403");
}

{
  const both = evaluateOperatorPolicy({ addressScreen: blocked, geo: denyGeo });
  assert(both.reason === "DENY_ADDRESS_BLOCKED", "address block wins when both deny");
}

{
  const listedBlocked = evaluateOperatorPolicy({
    addressScreen: { decision: "blocked", freshness: "stale" },
    geo: allowGeo,
  });
  assert(listedBlocked.reason === "DENY_ADDRESS_BLOCKED", "listed address still blocked on stale last-known-good");
}

{
  const d = evaluateOperatorPolicy({ addressScreen: stale, geo: allowGeo });
  const body = publicPolicyBody(d);
  assert(body.ok === false, "public body ok=false");
  assert(body.reason === "UNAVAILABLE_DATASET_STALE", "machine reason");
  assert(body.error === USER_POLICY_MESSAGES.UNAVAILABLE_DATASET_STALE, "same user + machine pair");
  assert(body.policy === OPERATOR_POLICY_ID, "policy id");
  assert(body.disclaimer === OPERATOR_POLICY_DISCLAIMER, "disclaimer");
  assert(!JSON.stringify(body).includes("sdn"), "no SDN leak");
  assert(!JSON.stringify(body).includes("datasetVersion"), "no dataset internals");
}

{
  const d = evaluateOperatorPolicy({ addressScreen: blocked, geo: allowGeo });
  const status = publicStatusView(d);
  assert(status.ok === false && status.writesAllowed === false, "status deny flags");
  assert(status.kind === "wallet" && status.reason === "DENY_ADDRESS_BLOCKED", "status kind wallet");
  assert(status.source === "indexer" && status.policy === OPERATOR_POLICY_ID, "status source");
  assert(uxKindForReason("DENY_GEO_BLOCKED") === "geo", "geo kind");
  assert(uxKindForReason("UNAVAILABLE_WALLET_MISSING") === "unavailable", "missing proof is unavailable kind");
  assert(uxKindForReason("ALLOW") === "allow", "allow kind");
  const leaked = JSON.stringify(status);
  assert(!leaked.includes("addressScreen") && !leaked.includes("sdn"), "status has no internals");
}

{
  assert(normalizeEvmAddress("0x1111111111111111111111111111111111111111") === "0x1111111111111111111111111111111111111111", "lower");
  assert(normalizeEvmAddress("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") === "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "checksum fold");
  assert(normalizeEvmAddress("not-an-address") === undefined, "garbage");
  assert(normalizeEvmAddress("0xabc") === undefined, "short");
}

console.log("sanctions-policy unit ok");
