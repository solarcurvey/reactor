import { extractPublishDate, mergeParseResults, parseOfacXml } from "./parse.ts";
import { FIXTURE_ADDRESSES, readFixture } from "./fixtures.ts";
import { normalizeEvm } from "./normalize.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const sdn = parseOfacXml(readFixture("sdn.xml"), {
  sourceId: "ofac-sdn-xml",
  sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml",
  format: "sdn_xml",
});

{
  const evmKey = normalizeEvm(FIXTURE_ADDRESSES.sanctionedEvm);
  const hit = sdn.addresses.find((a) => a.canonicalKey === evmKey);
  assert(hit, "classic SDN indexes fixture ETH");
  assert(hit.family === "evm", "ETH family is evm");
  assert(hit.ofacTickers.includes("ETH"), "retains ETH ticker");
  assert(hit.sdnUids.includes("900001") && hit.sdnUids.includes("900002"), "duplicate entries merge SDN uids");
  assert(hit.names.includes("ACME SANCTIONED DESK"), "retains entity name");
  assert(sdn.warnings.some((w) => w.kind === "duplicate"), "duplicate ETH rows recorded");
}

{
  const malformed = sdn.warnings.filter((w) => w.kind === "malformed_address");
  assert(malformed.some((w) => w.raw === FIXTURE_ADDRESSES.malformedEvm), "0xdead skipped");
  assert(!sdn.addresses.some((a) => a.display === "AB1234567"), "passport id is not an address");
  assert(!sdn.addresses.some((a) => a.canonicalKey.includes("dead")), "malformed evm not indexed");
}

{
  const btc = sdn.addresses.find((a) => a.family === "btc");
  assert(btc?.canonicalKey === `btc:${FIXTURE_ADDRESSES.sanctionedBtc}`, "XBT stays btc");
  assert(btc.canonicalKey !== normalizeEvm(FIXTURE_ADDRESSES.sanctionedEvm), "btc and evm keys differ");
  assert(extractPublishDate(readFixture("sdn.xml")) === "09/12/2026", "classic publish date");
}

{
  const adv = parseOfacXml(readFixture("sdn_advanced.xml"), {
    sourceId: "ofac-sdn-advanced-xml",
    sourceUrl: "https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml",
    format: "sdn_advanced_xml",
  });
  const evm = adv.addresses.find((a) => a.family === "evm");
  assert(evm?.canonicalKey === normalizeEvm(FIXTURE_ADDRESSES.sanctionedEvm), "advanced FeatureTypeID 344 → evm");
  assert(evm.sdnUids.includes("900010"), "advanced Profile ID retained");
  assert(evm.names.includes("ACME ADVANCED DESK"), "advanced name retained");
  const xmr = adv.addresses.find((a) => a.family === "xmr");
  assert(xmr?.canonicalKey === `xmr:${FIXTURE_ADDRESSES.sanctionedXmrHex}`, "XMR hex is its own family");
  assert(!adv.addresses.some((a) => a.display === "ZZ9999999"), "passport FeatureType skipped");
  assert(adv.publishDate === "2026-09-12", "DateOfIssue → ISO-ish publish date");
}

{
  const cons = parseOfacXml(readFixture("consolidated.xml"), {
    sourceId: "ofac-consolidated-xml",
    sourceUrl: "https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml",
    format: "consolidated_xml",
  });
  assert(cons.addresses.some((a) => a.family === "trx" && a.canonicalKey === `trx:${FIXTURE_ADDRESSES.sanctionedTrx}`), "TRX family");
  assert(cons.addresses.some((a) => a.family === "sol" && a.canonicalKey.startsWith("sol:")), "SOL family");
  const usdt = cons.addresses.find((a) => a.ofacTickers.includes("USDT"));
  assert(usdt?.family === "evm", "USDT 0x-40hex uses evm 20-byte identity");
  assert(usdt.canonicalKey === normalizeEvm(FIXTURE_ADDRESSES.sanctionedEvm), "USDT hex does not invent a second evm key");
}

{
  const merged = mergeParseResults([
    sdn,
    parseOfacXml(readFixture("sdn_advanced.xml"), {
      sourceId: "ofac-sdn-advanced-xml",
      sourceUrl: "https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml",
      format: "sdn_advanced_xml",
    }),
  ]);
  const evm = merged.addresses.find((a) => a.canonicalKey === normalizeEvm(FIXTURE_ADDRESSES.sanctionedEvm));
  assert(evm, "merged evm present once");
  assert(evm.sources.some((s) => s.sourceId === "ofac-sdn-xml"), "classic source metadata");
  assert(evm.sources.some((s) => s.sourceId === "ofac-sdn-advanced-xml"), "advanced source metadata");
  assert(merged.addresses.filter((a) => a.canonicalKey === evm.canonicalKey).length === 1, "one canonical row");
}

{
  let threw = false;
  try {
    parseOfacXml("not xml at all", { sourceId: "x", sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml", format: "sdn_xml" });
  } catch {
    threw = true;
  }
  assert(threw, "non-XML document fails parse");

  const empty = parseOfacXml(readFixture("empty.xml"), {
    sourceId: "empty",
    sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.xml",
    format: "sdn_xml",
  });
  assert(empty.addresses.length === 0, "empty SDN has no addresses");
}

console.log("parse.test.ts ok");
