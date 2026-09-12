import { fetchOfficialSource, type FetchOfficialOpts } from "./fetch.ts";
import { sha256Hex } from "./hash.ts";
import { extractPublishDate, extractRecordCount, mergeParseResults, parseOfacXml } from "./parse.ts";
import { DEFAULT_REFRESH_SOURCE_IDS, officialSourceById, type OfficialSource } from "./sources.ts";
import { resolveActivateValidation, type ActivateResult, type ActivateValidation, type SanctionsStore } from "./store.ts";
import type { DatasetVersion, ParseWarning, SourceFetchMeta } from "./types.ts";

export type RefreshOpts = {
  sourceIds?: readonly string[];
  sources?: OfficialSource[];
  fetch?: FetchOfficialOpts;
  validation?: ActivateValidation;
  now?: () => number;
  /** Inject bodies instead of HTTPS (unit tests / fixture load). */
  bodies?: Record<string, string>;
};

export type RefreshResult =
  | { ok: true; version: DatasetVersion; warningCount: number; warnings: ParseWarning[] }
  | { ok: false; error: string; preservedVersion: DatasetVersion | null };

function resolveSources(opts: RefreshOpts): OfficialSource[] {
  if (opts.sources?.length) return [...opts.sources];
  const ids = opts.sourceIds ?? DEFAULT_REFRESH_SOURCE_IDS;
  const out: OfficialSource[] = [];
  for (const id of ids) {
    const s = officialSourceById(id);
    if (!s) throw new Error(`unknown official source id: ${id}`);
    out.push(s);
  }
  return out;
}

/**
 * Download + parse the complete replacement, then activate atomically.
 * A partial or broken download does not overwrite last-known-good.
 */
export async function refreshSanctions(store: SanctionsStore, opts: RefreshOpts = {}): Promise<RefreshResult> {
  const prior = store.active();
  const sources = resolveSources(opts);
  const retrievedAt = new Date((opts.now ?? Date.now)()).toISOString();
  const metas: SourceFetchMeta[] = [];
  const parts = [];

  try {
    for (const source of sources) {
      const injected = opts.bodies?.[source.id];
      const fetched = injected
        ? {
            body: injected,
            meta: {
              id: source.id,
              url: source.url,
              format: source.format,
              retrievedAt,
              contentHash: sha256Hex(injected),
              byteLength: Buffer.byteLength(injected),
              httpStatus: 200,
            } satisfies SourceFetchMeta,
          }
        : await fetchOfficialSource(source, opts.fetch);

      if (!fetched.body.includes("<") || !/sdnList|Sanctions|sdnEntry|DistinctPart|Digital Currency Address/i.test(fetched.body)) {
        throw new Error(`${source.id}: body is not OFAC XML`);
      }

      const parsed = parseOfacXml(fetched.body, {
        sourceId: source.id,
        sourceUrl: source.url,
        format: source.format,
      });
      fetched.meta.publishDate = parsed.publishDate ?? extractPublishDate(fetched.body);
      fetched.meta.recordCount = parsed.recordCount ?? extractRecordCount(fetched.body);
      metas.push(fetched.meta);
      parts.push(parsed);
    }

    const merged = mergeParseResults(parts);
    const activated = store.activate(
      {
        addresses: merged.addresses,
        sources: metas,
        retrievedAt,
        warningCount: merged.warnings.length,
        entryCount: merged.addresses.length,
      },
      resolveActivateValidation(opts.validation),
    );
    return toRefreshResult(activated, merged.warnings);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      preservedVersion: prior?.version ?? store.active()?.version ?? null,
    };
  }
}

function toRefreshResult(activated: ActivateResult, warnings: ParseWarning[]): RefreshResult {
  if (activated.ok) {
    return { ok: true, version: activated.snapshot.version, warningCount: warnings.length, warnings };
  }
  return { ok: false, error: activated.error, preservedVersion: activated.preserved?.version ?? null };
}

export async function loadFixtures(store: SanctionsStore, fixtures: Record<string, { sourceId: string; xml: string; format: OfficialSource["format"]; url?: string }>): Promise<RefreshResult> {
  const bodies: Record<string, string> = {};
  const sources: OfficialSource[] = [];
  for (const fix of Object.values(fixtures)) {
    bodies[fix.sourceId] = fix.xml;
    sources.push({
      id: fix.sourceId,
      url: fix.url ?? `https://www.treasury.gov/ofac/downloads/fixtures/${fix.sourceId}.xml`,
      format: fix.format,
      publisher: "U.S. Department of the Treasury / OFAC (pinned fixture)",
      documentation: "https://ofac.treasury.gov/specially-designated-nationals-list-data-formats-data-schemas",
    });
  }
  return refreshSanctions(store, { sources, bodies });
}
