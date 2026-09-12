import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSanctionsRequest, RELEASE_GATE_60_CHILDREN } from "./http.ts";
import { SanctionsStore } from "./store.ts";
import { refreshSanctions } from "./refresh.ts";
import { FIXTURE_ADDRESSES, pinnedFixtureBodies } from "./fixtures.ts";
import { SCREEN_DISCLAIMER } from "./types.ts";
import { assertOfficialSourceUrl, OFFICIAL_SOURCE_HOSTS } from "./sources.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  assertOfficialSourceUrl("https://www.treasury.gov/ofac/downloads/sdn.xml");
  let http = false;
  try {
    assertOfficialSourceUrl("http://www.treasury.gov/ofac/downloads/sdn.xml");
  } catch {
    http = true;
  }
  assert(http, "HTTP rejected");
  let third = false;
  try {
    assertOfficialSourceUrl("https://example.com/sdn.xml");
  } catch {
    third = true;
  }
  assert(third, "third-party host rejected");
  assert(OFFICIAL_SOURCE_HOSTS.has("sanctionslistservice.ofac.treas.gov"), "SLS host documented");
}

const dir = mkdtempSync(join(tmpdir(), "sanctions-http-"));
const now = () => Date.parse("2026-09-12T00:00:00.000Z");

try {
  const store = new SanctionsStore({ dataDir: dir, now });
  const missing = handleSanctionsRequest(store, {
    method: "GET",
    pathname: "/sanctions/screen",
    searchParams: new URLSearchParams({ address: FIXTURE_ADDRESSES.clearEvm }),
  });
  assert(missing.status === 200, "lookup still 200 without dataset");
  assert((missing.body as { decision: string }).decision === "unavailable", "missing dataset is unavailable");

  await refreshSanctions(store, {
    sourceIds: ["ofac-sdn-xml"],
    bodies: pinnedFixtureBodies(),
    now,
    validation: { minAddresses: 1, rejectIfFewerThanPriorRatio: 0 },
  });

  const blocked = handleSanctionsRequest(store, {
    method: "GET",
    pathname: "/sanctions/screen",
    searchParams: new URLSearchParams({ address: FIXTURE_ADDRESSES.sanctionedEvmMixed }),
  });
  assert(blocked.status === 200 && (blocked.body as { decision: string }).decision === "blocked", "http blocked");
  assert((blocked.body as { disclaimer: string }).disclaimer === SCREEN_DISCLAIMER, "http disclaimer");
  assert((blocked.body as { datasetVersion: { id: string } }).datasetVersion.id, "http version");

  const dataset = handleSanctionsRequest(store, {
    method: "GET",
    pathname: "/sanctions/dataset",
    searchParams: new URLSearchParams(),
  });
  assert(dataset.status === 200, "dataset route");
  assert((dataset.body as { freshness: string }).freshness === "current", "freshness current");
  assert((dataset.body as { policyGate: null }).policyGate === null, "policy gate not this PR");

  const bad = handleSanctionsRequest(store, {
    method: "GET",
    pathname: "/sanctions/screen",
    searchParams: new URLSearchParams(),
  });
  assert(bad.status === 400, "address required");

  assert(RELEASE_GATE_60_CHILDREN.length === 3, "later children listed, not implemented");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("http.test.ts ok");
