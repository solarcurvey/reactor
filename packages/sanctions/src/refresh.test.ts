import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SanctionsStore } from "./store.ts";
import { refreshSanctions } from "./refresh.ts";
import { pinnedFixtureBodies, readFixture } from "./fixtures.ts";
import { OFFICIAL_SOURCES } from "./sources.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "sanctions-refresh-"));
const now = () => Date.parse("2026-09-12T00:00:00.000Z");

try {
  const store = new SanctionsStore({ dataDir: dir, now });
  const bodies = pinnedFixtureBodies();
  const good = await refreshSanctions(store, {
    sourceIds: ["ofac-sdn-xml", "ofac-sdn-advanced-xml"],
    bodies,
    now,
    validation: { minAddresses: 1, rejectIfFewerThanPriorRatio: 0 },
  });
  assert(good.ok, "fixture refresh activates");
  const goodId = good.ok ? good.version.id : "";
  assert(store.active()?.version.id === goodId, "active is fixture set");
  assert(store.active()?.version.sources.every((s) => s.url.startsWith("https://www.treasury.gov/")), "source URLs official");
  assert(store.active()?.version.sources[0]?.contentHash.length === 64, "source content hash");
  assert(store.active()?.version.sources[0]?.publishDate, "publish metadata retained");

  const pointerBefore = readFileSync(join(dir, "current.json"), "utf8");

  const empty = await refreshSanctions(store, {
    sources: [OFFICIAL_SOURCES[0]!],
    bodies: { "ofac-sdn-xml": readFixture("empty.xml") },
    now,
    validation: { minAddresses: 1 },
  });
  assert(!empty.ok, "empty download rejected");
  assert(empty.preservedVersion?.id === goodId, "reports preserved version");
  assert(store.active()?.version.id === goodId, "active unchanged after empty");
  assert(readFileSync(join(dir, "current.json"), "utf8") === pointerBefore, "current.json bytes unchanged");

  const broken = await refreshSanctions(store, {
    sources: [OFFICIAL_SOURCES[0]!],
    bodies: { "ofac-sdn-xml": readFixture("broken.xml") },
    now,
    validation: { minAddresses: 1 },
  });
  assert(!broken.ok, "broken XML does not activate");
  assert(store.active()?.version.id === goodId, "last-known-good after broken parse");

  const notXml = await refreshSanctions(store, {
    sources: [OFFICIAL_SOURCES[0]!],
    bodies: { "ofac-sdn-xml": "just a html mirror <html></html>" },
    now,
  });
  assert(!notXml.ok, "non-OFAC body rejected");
  assert(store.active()?.version.id === goodId, "last-known-good after junk body");

  let fetchCalls = 0;
  const partial = await refreshSanctions(store, {
    sourceIds: ["ofac-sdn-xml", "ofac-sdn-advanced-xml"],
    now,
    fetch: {
      fetchImpl: async (url) => {
        fetchCalls += 1;
        if (String(url).includes("sdn_advanced")) throw new Error("simulated download failure");
        return new Response(bodies["ofac-sdn-xml"], { status: 200, headers: { "content-type": "text/xml" } });
      },
    },
  });
  assert(!partial.ok, "partial multi-source download rejected");
  assert(fetchCalls >= 1, "first source was attempted");
  assert(store.active()?.version.id === goodId, "partial download must not replace last-known-good");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("refresh.test.ts ok");
