import { screen } from "./screen.ts";
import { SanctionsStore } from "./store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOfacXml, mergeParseResults } from "./parse.ts";
import { pinnedFixtureBodies, FIXTURE_ADDRESSES } from "./fixtures.ts";
import { SCREEN_DISCLAIMER } from "./types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "sanctions-screen-"));
const retrievedAt = "2026-09-12T00:00:00.000Z";
const now = () => Date.parse(retrievedAt);

try {
  const store = new SanctionsStore({ dataDir: dir, now, maxAgeMs: 24 * 60 * 60 * 1000 });
  const bodies = pinnedFixtureBodies();
  const merged = mergeParseResults([
    parseOfacXml(bodies["ofac-sdn-xml"]!, { sourceId: "ofac-sdn-xml", sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml", format: "sdn_xml" }),
    parseOfacXml(bodies["ofac-sdn-advanced-xml"]!, { sourceId: "ofac-sdn-advanced-xml", sourceUrl: "https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml", format: "sdn_advanced_xml" }),
    parseOfacXml(bodies["ofac-consolidated-xml"]!, { sourceId: "ofac-consolidated-xml", sourceUrl: "https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml", format: "consolidated_xml" }),
  ]);
  const act = store.activate({
    addresses: merged.addresses,
    sources: [],
    retrievedAt,
    warningCount: merged.warnings.length,
  });
  assert(act.ok, "fixture activate");

  const mixed = store.screen(FIXTURE_ADDRESSES.sanctionedEvmMixed);
  assert(mixed.decision === "blocked", "mixed-case evm blocked");
  assert(mixed.datasetVersion?.id === act.snapshot.version.id, "version on blocked");
  assert(mixed.match?.family === "evm", "match family");
  assert(mixed.disclaimer === SCREEN_DISCLAIMER, "disclaimer present");

  const noPrefix = store.screen(FIXTURE_ADDRESSES.sanctionedEvmNoPrefix);
  assert(noPrefix.decision === "blocked", "no 0x prefix still matches evm identity");

  const clear = store.screen(FIXTURE_ADDRESSES.clearEvm);
  assert(clear.decision === "clear", "nonsanctioned evm is clear");
  assert(clear.match === null, "clear has no match");
  assert(clear.datasetVersion?.contentHash, "version on clear");

  const btcHit = store.screen(FIXTURE_ADDRESSES.sanctionedBtc);
  assert(btcHit.decision === "blocked" && btcHit.match?.family === "btc", "btc blocked");
  const btcAsEvm = store.screen(FIXTURE_ADDRESSES.sanctionedBtc, { family: "evm" });
  assert(btcAsEvm.decision === "unavailable" && btcAsEvm.reason === "invalid_query", "btc queried as evm is invalid, not clear");

  const evmAsBtc = store.screen(FIXTURE_ADDRESSES.sanctionedEvm, { family: "btc" });
  assert(evmAsBtc.decision === "unavailable", "evm queried as btc does not collapse families");

  const clearBtc = store.screen(FIXTURE_ADDRESSES.clearBtc);
  assert(clearBtc.decision === "clear", "nonsanctioned btc is clear");

  const trx = store.screen(FIXTURE_ADDRESSES.sanctionedTrx);
  assert(trx.decision === "blocked" && trx.match?.family === "trx", "trx blocked");

  const missing = screen(FIXTURE_ADDRESSES.clearEvm, null);
  assert(missing.decision === "unavailable" && missing.reason === "missing_dataset", "no dataset is unavailable, not clear");

  const garbageEvm = store.screen("not-an-address", { family: "evm" });
  assert(garbageEvm.decision === "unavailable" && garbageEvm.reason === "invalid_query", "non-evm string as evm is unavailable");
  const empty = store.screen("   ");
  assert(empty.decision === "unavailable" && empty.reason === "invalid_query", "blank query is unavailable");
  const unknownShape = store.screen("not-an-address");
  assert(unknownShape.decision === "clear", "unlisted unrecognized shape is an exact miss, not an error");

  const staleNow = () => Date.parse(retrievedAt) + 8 * 24 * 60 * 60 * 1000;
  const staleHit = screen(FIXTURE_ADDRESSES.sanctionedEvm, store.active(), { now: staleNow, maxAgeMs: 24 * 60 * 60 * 1000 });
  assert(staleHit.decision === "blocked" && staleHit.freshness === "stale", "known hit still blocked when stale");
  const staleClear = screen(FIXTURE_ADDRESSES.clearEvm, store.active(), { now: staleNow, maxAgeMs: 24 * 60 * 60 * 1000 });
  assert(staleClear.decision === "unavailable" && staleClear.reason === "stale_dataset", "stale miss is unavailable, not clear");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("screen.test.ts ok");
