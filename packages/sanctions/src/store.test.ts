import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SanctionsStore } from "./store.ts";
import { PARSER_VERSION, type SanctionedAddress } from "./types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function addr(key: string): SanctionedAddress {
  return {
    family: "evm",
    canonicalKey: key,
    display: key.slice(4),
    ofacTickers: ["ETH"],
    sdnUids: ["1"],
    names: ["X"],
    sources: [{ sourceId: "ofac-sdn-xml", sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml" }],
  };
}

const dir = mkdtempSync(join(tmpdir(), "sanctions-store-"));
const now = () => Date.parse("2026-09-12T00:00:00.000Z");

try {
  const store = new SanctionsStore({ dataDir: dir, now });
  const first = store.activate({
    addresses: [addr("evm:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
    sources: [
      {
        id: "ofac-sdn-xml",
        url: "https://www.treasury.gov/ofac/downloads/sdn.xml",
        format: "sdn_xml",
        retrievedAt: "2026-09-12T00:00:00.000Z",
        contentHash: "aa",
        byteLength: 10,
        httpStatus: 200,
        publishDate: "09/12/2026",
      },
    ],
    retrievedAt: "2026-09-12T00:00:00.000Z",
    warningCount: 0,
  });
  assert(first.ok, "first activate ok");
  assert(first.snapshot.version.parserVersion === PARSER_VERSION, "parser version recorded");
  assert(first.snapshot.version.contentHash.length === 64, "content hash");
  const pointer = JSON.parse(readFileSync(join(dir, "current.json"), "utf8")) as { versionId: string };
  assert(pointer.versionId === first.snapshot.version.id, "current pointer");

  const empty = store.activate(
    {
      addresses: [],
      sources: first.snapshot.version.sources,
      retrievedAt: "2026-09-12T01:00:00.000Z",
      warningCount: 0,
    },
    { minAddresses: 1 },
  );
  assert(!empty.ok, "empty replacement rejected");
  assert(store.active()?.version.id === first.snapshot.version.id, "last-known-good kept after empty");

  const tiny = store.activate(
    {
      addresses: [addr("evm:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")],
      sources: first.snapshot.version.sources,
      retrievedAt: "2026-09-12T01:00:00.000Z",
      warningCount: 0,
    },
    { minAddresses: 1, rejectIfFewerThanPriorRatio: 2 },
  );
  assert(!tiny.ok, "ratio floor rejects shrink");
  assert(store.active()?.version.id === first.snapshot.version.id, "pointer unchanged after ratio reject");

  const disk = new SanctionsStore({ dataDir: dir, now });
  const loaded = disk.loadFromDisk();
  assert(loaded?.version.id === first.snapshot.version.id, "reload last-known-good");
  assert(loaded.index.has("evm:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "index rebuilt");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("store.test.ts ok");
