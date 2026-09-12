import { candidateKeys, extractOfacTicker, familyFromTicker, canonicalKey } from "./normalize.ts";
import type { AddressFamily, OfficialSourceFormat, ParseResult, ParseWarning, SanctionedAddress } from "./types.ts";

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

function localTag(name: string): string {
  return name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
}

function firstTagText(xml: string, localName: string): string | undefined {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`, "i");
  const m = xml.match(re);
  if (!m?.[1]) return undefined;
  const inner = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return inner ? decodeBasicEntities(inner) : undefined;
}

function allTagTexts(xml: string, localName: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const inner = (m[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (inner) out.push(decodeBasicEntities(inner));
  }
  return out;
}

function extractBlocks(xml: string, localName: string): string[] {
  const out: string[] = [];
  const openRe = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml))) {
    const open = m[0];
    const start = m.index + open.length;
    const closeRe = new RegExp(`</(?:[\\w.-]+:)?${localName}>`, "gi");
    closeRe.lastIndex = start;
    const close = closeRe.exec(xml);
    if (!close) break;
    out.push(`${open}${xml.slice(start, close.index)}`);
    openRe.lastIndex = close.index + close[0].length;
  }
  return out;
}

function openingTag(block: string): string {
  const m = block.match(/^<[^>]+>/);
  return m?.[0] ?? "";
}

function attr(tagOpen: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tagOpen.match(re);
  return m?.[2] ?? m?.[3];
}

export function extractPublishDate(xml: string): string | undefined {
  const classic = firstTagText(xml, "Publish_Date") ?? firstTagText(xml, "PublishDate");
  if (classic) return classic;
  const year = firstTagText(xml, "Year");
  const month = firstTagText(xml, "Month");
  const day = firstTagText(xml, "Day");
  if (year && month && day) {
    const mm = month.padStart(2, "0");
    const dd = day.padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }
  return undefined;
}

export function extractRecordCount(xml: string): number | undefined {
  const raw = firstTagText(xml, "Record_Count") ?? firstTagText(xml, "RecordCount");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

type RawHit = {
  ticker: string;
  address: string;
  sdnUid?: string;
  name?: string;
};

function featureTypeMap(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<(?:[\w.-]+:)?FeatureType\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?FeatureType>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const open = m[1] ?? "";
    const body = m[2] ?? "";
    const id = attr(open, "ID") ?? attr(open, "FeatureTypeID") ?? firstTagText(body, "FeatureTypeID");
    const name =
      firstTagText(body, "Name") ??
      decodeBasicEntities(body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (id && /Digital Currency Address/i.test(name)) map.set(id, name);
  }
  return map;
}

function hitsFromClassicEntries(xml: string): RawHit[] {
  const hits: RawHit[] = [];
  const entries = extractBlocks(xml, "sdnEntry");
  for (const entry of entries) {
    const uid = firstTagText(entry, "uid");
    const last = firstTagText(entry, "lastName");
    const first = firstTagText(entry, "firstName");
    const name = [first, last].filter(Boolean).join(" ") || firstTagText(entry, "lastName");
    for (const id of extractBlocks(entry, "id")) {
      const idType = firstTagText(id, "idType");
      const idNumber = firstTagText(id, "idNumber");
      if (!idType || !idNumber) continue;
      const ticker = extractOfacTicker(idType);
      if (!ticker) continue;
      hits.push({ ticker, address: idNumber, sdnUid: uid, name });
    }
  }
  return hits;
}

function hitsFromAdvanced(xml: string): RawHit[] {
  const types = featureTypeMap(xml);
  const hits: RawHit[] = [];
  const parties = extractBlocks(xml, "DistinctParty");
  const profiles = parties.length
    ? parties.flatMap((p) => extractBlocks(p, "Profile").map((pr) => ({ party: p, profile: pr })))
    : extractBlocks(xml, "Profile").map((pr) => ({ party: xml, profile: pr }));

  for (const { party, profile } of profiles) {
    const open = openingTag(profile);
    const uid = attr(open, "ID") ?? firstTagText(profile, "ID") ?? firstTagText(party, "uid");
    const names = allTagTexts(profile, "NamePartValue");
    const name = names[0];
    for (const feature of extractBlocks(profile, "Feature")) {
      const typeId = firstTagText(feature, "FeatureTypeID") ?? (() => {
        const open = feature.match(/<(?:[\w.-]+:)?FeatureTypeID\b([^>]*)\/>/i);
        return open ? attr(open[1] ?? "", "ID") : undefined;
      })();
      const typeName =
        (typeId ? types.get(typeId) : undefined) ??
        firstTagText(feature, "FeatureType") ??
        "";
      const ticker = extractOfacTicker(typeName);
      if (!ticker) continue;
      const versions = allTagTexts(feature, "VersionDetail");
      for (const address of versions) {
        if (address) hits.push({ ticker, address, sdnUid: uid, name });
      }
    }
  }

  if (hits.length === 0) {
    hits.push(...hitsFromLooseDigitalCurrency(xml, types));
  }
  return hits;
}

function hitsFromLooseDigitalCurrency(xml: string, types: Map<string, string>): RawHit[] {
  const hits: RawHit[] = [];
  const re =
    /Digital Currency Address\s*[-–—]\s*([A-Za-z0-9]+)[\s\S]{0,400}<(?:[\w.-]+:)?(?:idNumber|VersionDetail)(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?(?:idNumber|VersionDetail)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const ticker = (m[1] ?? "").toUpperCase();
    const address = decodeBasicEntities((m[2] ?? "").replace(/<[^>]+>/g, "").trim());
    if (ticker && address) hits.push({ ticker, address });
  }
  void types;
  return hits;
}

function mergeAddress(
  index: Map<string, SanctionedAddress>,
  family: AddressFamily,
  key: string,
  display: string,
  ticker: string,
  uid: string | undefined,
  name: string | undefined,
  sourceId: string,
  sourceUrl: string,
  warnings: ParseWarning[],
): void {
  const existing = index.get(key);
  if (existing) {
    if (!existing.ofacTickers.includes(ticker)) existing.ofacTickers.push(ticker);
    if (uid && !existing.sdnUids.includes(uid)) existing.sdnUids.push(uid);
    if (name && !existing.names.includes(name)) existing.names.push(name);
    if (!existing.sources.some((s) => s.sourceId === sourceId)) {
      existing.sources.push({ sourceId, sourceUrl });
    }
    warnings.push({ kind: "duplicate", message: `merged duplicate ${key}`, sourceId, raw: display });
    return;
  }
  index.set(key, {
    family,
    canonicalKey: key,
    display,
    ofacTickers: [ticker],
    sdnUids: uid ? [uid] : [],
    names: name ? [name] : [],
    sources: [{ sourceId, sourceUrl }],
  });
}

export function parseOfacXml(
  xml: string,
  opts: { sourceId: string; sourceUrl: string; format: OfficialSourceFormat },
): ParseResult {
  if (!xml.trim()) {
    return { addresses: [], warnings: [{ kind: "skipped_row", message: "empty document", sourceId: opts.sourceId }] };
  }
  const body = stripComments(xml);
  if (!/<(?:\?xml|sdnList|Sanctions|sdnEntry|DistinctParties|Profile)\b/i.test(body)) {
    throw new Error(`${opts.sourceId}: not a recognizable OFAC SDN/consolidated XML document`);
  }

  const warnings: ParseWarning[] = [];
  const publishDate = extractPublishDate(body);
  const recordCount = extractRecordCount(body);

  const advanced = opts.format === "sdn_advanced_xml" || opts.format === "consolidated_advanced_xml";
  const hits = advanced ? [...hitsFromAdvanced(body), ...hitsFromClassicEntries(body)] : hitsFromClassicEntries(body);

  if (!advanced && hits.length === 0 && /Digital Currency Address/i.test(body)) {
    hits.push(...hitsFromAdvanced(body));
  }

  const index = new Map<string, SanctionedAddress>();
  for (const hit of hits) {
    const family = familyFromTicker(hit.ticker, hit.address);
    const key = canonicalKey(family, hit.address);
    if (!key) {
      warnings.push({
        kind: "malformed_address",
        message: `skipped ${hit.ticker} address that failed ${family} normalization`,
        sourceId: opts.sourceId,
        raw: hit.address,
      });
      continue;
    }
    mergeAddress(index, family, key, hit.address.trim(), hit.ticker, hit.sdnUid, hit.name, opts.sourceId, opts.sourceUrl, warnings);
  }

  return {
    addresses: [...index.values()].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey)),
    warnings,
    publishDate,
    recordCount,
  };
}

export function mergeParseResults(parts: ParseResult[]): ParseResult {
  const index = new Map<string, SanctionedAddress>();
  const warnings: ParseWarning[] = [];
  let publishDate: string | undefined;
  let recordCount = 0;
  for (const part of parts) {
    warnings.push(...part.warnings);
    if (part.publishDate && !publishDate) publishDate = part.publishDate;
    if (typeof part.recordCount === "number") recordCount += part.recordCount;
    for (const addr of part.addresses) {
      const existing = index.get(addr.canonicalKey);
      if (!existing) {
        index.set(addr.canonicalKey, {
          ...addr,
          ofacTickers: [...addr.ofacTickers],
          sdnUids: [...addr.sdnUids],
          names: [...addr.names],
          sources: [...addr.sources],
        });
        continue;
      }
      for (const t of addr.ofacTickers) if (!existing.ofacTickers.includes(t)) existing.ofacTickers.push(t);
      for (const u of addr.sdnUids) if (!existing.sdnUids.includes(u)) existing.sdnUids.push(u);
      for (const n of addr.names) if (!existing.names.includes(n)) existing.names.push(n);
      for (const s of addr.sources) {
        if (!existing.sources.some((x) => x.sourceId === s.sourceId)) existing.sources.push(s);
      }
      warnings.push({ kind: "duplicate", message: `merged ${addr.canonicalKey} across sources` });
    }
  }
  return {
    addresses: [...index.values()].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey)),
    warnings,
    publishDate,
    recordCount: recordCount || undefined,
  };
}

export function lookupKey(raw: string, family?: AddressFamily): string[] {
  return candidateKeys(raw, family);
}

void localTag;
