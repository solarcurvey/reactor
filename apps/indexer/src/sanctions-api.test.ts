import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSanctionsRequest } from "../../../packages/sanctions/src/index.ts";
import { SanctionsStore } from "../../../packages/sanctions/src/store.ts";
import { refreshSanctions } from "../../../packages/sanctions/src/refresh.ts";
import { FIXTURE_ADDRESSES, pinnedFixtureBodies } from "../../../packages/sanctions/src/fixtures.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert(src.includes('url.pathname === "/sanctions/screen"'), "indexer mounts /sanctions/screen");
  assert(src.includes('url.pathname === "/sanctions/dataset"'), "indexer mounts /sanctions/dataset");
  assert(src.includes("/ops/sanctions/refresh"), "ops refresh mounted");
  assert(src.includes("Not a #60 policy gate") || src.includes("not a #60 policy gate"), "policy gate left for later");
  const admit = readFileSync(new URL("./admission.ts", import.meta.url), "utf8");
  assert(admit.includes("RELEASE GATE #60"), "admission points at later #60 children");
  assert(!admit.includes("screen(") || admit.includes("Do not treat a missing dataset as clear"), "admission does not implement the policy gate");
}

const dir = mkdtempSync(join(tmpdir(), "indexer-sanctions-"));
const now = () => Date.parse("2026-09-12T00:00:00.000Z");
try {
  const store = new SanctionsStore({ dataDir: dir, now });
  await refreshSanctions(store, {
    sourceIds: ["ofac-sdn-xml"],
    bodies: pinnedFixtureBodies(),
    now,
    validation: { minAddresses: 1, rejectIfFewerThanPriorRatio: 0 },
  });
  const out = handleSanctionsRequest(store, {
    method: "GET",
    pathname: "/sanctions/screen",
    searchParams: new URLSearchParams({ address: FIXTURE_ADDRESSES.sanctionedEvmMixed }),
  });
  assert(out.status === 200 && (out.body as { decision: string }).decision === "blocked", "server-usable blocked");
  assert((out.body as { datasetVersion: { id: string } }).datasetVersion.id, "exposes dataset version");
  const meta = handleSanctionsRequest(store, {
    method: "GET",
    pathname: "/sanctions/dataset",
    searchParams: new URLSearchParams(),
  });
  assert((meta.body as { freshness: string }).freshness === "current", "exposes freshness");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("sanctions-api.test.ts ok");
