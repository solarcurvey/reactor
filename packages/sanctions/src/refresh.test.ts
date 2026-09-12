import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SanctionsStore } from "./store.ts";
import { refreshSanctions } from "./refresh.ts";
import { FIXTURE_ADDRESSES, pinnedFixtureBodies, readFixture } from "./fixtures.ts";
import { DEFAULT_REFRESH_SOURCE_IDS, OFFICIAL_SOURCES } from "./sources.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "sanctions-refresh-"));
const now = () => Date.parse("2026-09-12T00:00:00.000Z");

try {
  const store = new SanctionsStore({ dataDir: dir, now });
  const bodies = pinnedFixtureBodies();
  assert(DEFAULT_REFRESH_SOURCE_IDS.includes("ofac-consolidated-xml"), "default set includes consolidated");
  assert(DEFAULT_REFRESH_SOURCE_IDS.includes("ofac-consolidated-advanced-xml"), "default set includes cons advanced");
  for (const id of DEFAULT_REFRESH_SOURCE_IDS) {
    assert(bodies[id], `pinned fixture body for default source ${id}`);
  }

  const good = await refreshSanctions(store, {
    bodies,
    now,
  });
  assert(good.ok, `default refresh activates: ${"error" in good ? good.error : ""}`);
  const goodId = good.ok ? good.version.id : "";
  assert(store.active()?.version.id === goodId, "active is fixture set");
  assert(store.active()?.version.sources.map((s) => s.id).join(",") === DEFAULT_REFRESH_SOURCE_IDS.join(","), "default refresh recorded all canonical sources");
  assert(store.active()?.version.sourceCoverage.length === DEFAULT_REFRESH_SOURCE_IDS.length, "sourceCoverage recorded");
  assert(store.active()?.version.sources.every((s) => s.url.startsWith("https://www.treasury.gov/")), "source URLs official");
  assert(store.active()?.version.sources[0]?.contentHash.length === 64, "source content hash");
  assert(store.active()?.version.sources[0]?.publishDate, "publish metadata retained");

  const consOnly = store.screen(FIXTURE_ADDRESSES.sanctionedTrx);
  assert(consOnly.decision === "blocked" && consOnly.match?.family === "trx", "consolidated-only TRX is blocked after default refresh");
  assert(consOnly.match?.sources.some((s) => s.sourceId === "ofac-consolidated-xml"), "hit cites consolidated source");
  const consAdvOnly = store.screen(FIXTURE_ADDRESSES.sanctionedXrp);
  assert(consAdvOnly.decision === "blocked" && consAdvOnly.match?.family === "xrp", "consolidated-advanced-only XRP is blocked after default refresh");

  const evm = store.screen(FIXTURE_ADDRESSES.sanctionedEvmMixed);
  assert(evm.decision === "blocked", "sdn evm still blocked");
  assert((evm.match?.sources.length ?? 0) >= 1, "merged identity is one key");
  assert(store.active()?.index.has("evm:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "single evm canonical key");

  const pointerBefore = readFileSync(join(dir, "current.json"), "utf8");

  const empty = await refreshSanctions(store, {
    sources: [OFFICIAL_SOURCES[0]!],
    bodies: { "ofac-sdn-xml": readFixture("empty.xml") },
    now,
  });
  assert(!empty.ok, "empty download rejected");
  assert(empty.preservedVersion?.id === goodId, "reports preserved version");
  assert(store.active()?.version.id === goodId, "active unchanged after empty");
  assert(readFileSync(join(dir, "current.json"), "utf8") === pointerBefore, "current.json bytes unchanged");

  const broken = await refreshSanctions(store, {
    sources: [OFFICIAL_SOURCES[0]!],
    bodies: { "ofac-sdn-xml": readFixture("broken.xml") },
    now,
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
    now,
    fetch: {
      fetchImpl: async (url) => {
        fetchCalls += 1;
        if (String(url).includes("sdn_advanced")) throw new Error("simulated download failure");
        const id = String(url).includes("cons_advanced")
          ? "ofac-consolidated-advanced-xml"
          : String(url).includes("consolidated")
            ? "ofac-consolidated-xml"
            : String(url).includes("sdn_advanced")
              ? "ofac-sdn-advanced-xml"
              : "ofac-sdn-xml";
        return new Response(bodies[id], { status: 200, headers: { "content-type": "text/xml" } });
      },
    },
  });
  assert(!partial.ok, "partial multi-source download rejected");
  assert(fetchCalls >= 1, "first source was attempted");
  assert(store.active()?.version.id === goodId, "partial download must not replace last-known-good");

  const truncatedBodies = {
    ...bodies,
    "ofac-sdn-xml": readFixture("truncated_valid.xml"),
    "ofac-sdn-advanced-xml": readFixture("empty.xml"),
    "ofac-consolidated-xml": readFixture("empty.xml"),
    "ofac-consolidated-advanced-xml": readFixture("empty.xml"),
  };
  const truncated = await refreshSanctions(store, { bodies: truncatedBodies, now });
  assert(!truncated.ok, "valid-but-gutted XML must not replace last-known-good");
  assert(/floor|collapsed|shrank|omitted/i.test(truncated.ok ? "" : truncated.error), `completeness error, got: ${"error" in truncated ? truncated.error : ""}`);
  assert(store.active()?.version.id === goodId, "last-known-good after truncated-valid parse");
  assert(store.screen(FIXTURE_ADDRESSES.sanctionedTrx).decision === "blocked", "consolidated-only address still blocked on last-known-good");

  const forced = await refreshSanctions(store, {
    bodies: truncatedBodies,
    now,
    validation: { allowCatastrophicShrink: true },
  });
  assert(forced.ok, "explicit allowCatastrophicShrink is the exceptional path");
  assert(store.screen(FIXTURE_ADDRESSES.sanctionedTrx).decision === "clear", "after explicit shrink, consolidated-only address is no longer listed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("refresh.test.ts ok");
