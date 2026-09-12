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
  assert(first.snapshot.version.sourceCoverage.some((c) => c.sourceId === "ofac-sdn-xml" && c.addressCount === 1), "sourceCoverage recorded");
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

  const many = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
    addr(`evm:0x${i.toString().padStart(40, "a")}`),
  );
  const filled = store.activate({
    addresses: many,
    sources: [{ ...first.snapshot.version.sources[0]!, byteLength: 10_000 }],
    retrievedAt: "2026-09-12T01:00:00.000Z",
    warningCount: 0,
  });
  assert(filled.ok, "grow from 1 to 10 ok");

  const gutted = store.activate({
    addresses: [addr("evm:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")],
    sources: [{ ...first.snapshot.version.sources[0]!, byteLength: 10_000 }],
    retrievedAt: "2026-09-12T02:00:00.000Z",
    warningCount: 0,
  });
  assert(!gutted.ok, "default 85% floor rejects 10→1 valid shrink");
  assert(store.active()?.version.addressCount === 10, "pointer unchanged after gutted valid set");

  const override = store.activate(
    {
      addresses: [addr("evm:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")],
      sources: [{ ...first.snapshot.version.sources[0]!, byteLength: 10_000 }],
      retrievedAt: "2026-09-12T02:00:00.000Z",
      warningCount: 0,
    },
    { allowCatastrophicShrink: true },
  );
  assert(override.ok, "explicit allowCatastrophicShrink overrides the floor");

  const disk = new SanctionsStore({ dataDir: dir, now });
  const loaded = disk.loadFromDisk();
  assert(loaded?.version.id === override.snapshot.version.id, "reload last activate");
  assert(loaded.index.has("evm:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "index rebuilt");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("store.test.ts ok");

{
  const genDir = mkdtempSync(join(tmpdir(), "sanctions-gen-"));
  const t0 = "2026-09-01T00:00:00.000Z";
  const t1 = "2026-09-12T12:00:00.000Z";
  const addresses = [addr("evm:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")];
  const sourceT0 = {
    id: "ofac-sdn-xml",
    url: "https://www.treasury.gov/ofac/downloads/sdn.xml",
    format: "sdn_xml" as const,
    retrievedAt: t0,
    contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    byteLength: 4_000,
    httpStatus: 200,
    etag: '"gen-0"',
    lastModified: "Mon, 01 Sep 2026 00:00:00 GMT",
    publishDate: "09/01/2026",
  };
  try {
    const a = new SanctionsStore({ dataDir: genDir, now: () => Date.parse(t0), maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    const first = a.activate({ addresses, sources: [sourceT0], retrievedAt: t0, warningCount: 0 });
    assert(first.ok, "t0 activate");
    const hash0 = first.snapshot.version.contentHash;
    const id0 = first.snapshot.version.id;

    const sourceT1 = {
      ...sourceT0,
      retrievedAt: t1,
      etag: '"gen-1"',
      lastModified: "Sat, 12 Sep 2026 12:00:00 GMT",
      publishDate: "09/12/2026",
    };
    const second = a.activate({ addresses, sources: [sourceT1], retrievedAt: t1, warningCount: 0 });
    assert(second.ok, "t1 same-address refresh activates");
    assert(second.snapshot.version.contentHash === hash0, "address-set contentHash unchanged");
    assert(second.snapshot.version.id !== id0, "generation id advances when retrieval metadata changes");
    assert(second.snapshot.version.retrievedAt === t1, "in-memory retrievedAt is t1");
    assert(second.snapshot.version.sources[0]?.etag === '"gen-1"', "in-memory etag is t1");

    const reloaded = new SanctionsStore({
      dataDir: genDir,
      now: () => Date.parse(t1),
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    });
    const disk = reloaded.loadFromDisk();
    assert(disk, "fresh store loads disk");
    assert(disk.version.retrievedAt === t1, "persisted retrievedAt is t1, not t0");
    assert(disk.version.sources[0]?.etag === '"gen-1"', "persisted ETag is t1");
    assert(disk.version.sources[0]?.lastModified === sourceT1.lastModified, "persisted Last-Modified is t1");
    assert(disk.version.sources[0]?.publishDate === "09/12/2026", "persisted publish date is t1");
    assert(disk.version.id === second.snapshot.version.id, "pointer targets t1 generation");
    assert(reloaded.freshness() === "current", "freshness after reload is current");
    const late = new SanctionsStore({
      dataDir: genDir,
      now: () => Date.parse(t1) + 8 * 24 * 60 * 60 * 1000,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    });
    late.loadFromDisk();
    assert(late.freshness() === "stale", "ages from persisted t1, not a lost in-memory clock");
  } finally {
    rmSync(genDir, { recursive: true, force: true });
  }
  console.log("store.generation.test ok");
}
