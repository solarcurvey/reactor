import { createHash } from "node:crypto";
import type { SanctionedAddress, SourceFetchMeta } from "./types.ts";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Stable hash of the normalized address set (sorted keys + source metadata). */
export function datasetContentHash(addresses: SanctionedAddress[]): string {
  const rows = [...addresses]
    .map((a) => ({
      k: a.canonicalKey,
      f: a.family,
      t: [...a.ofacTickers].sort(),
      u: [...a.sdnUids].sort(),
      s: a.sources.map((x) => x.sourceId).sort(),
    }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return sha256Hex(JSON.stringify(rows));
}

/** Hash of retrieval + per-source publication/HTTP metadata. Same addresses, new fetch → new generation. */
export function sourceGenerationHash(sources: SourceFetchMeta[], retrievedAt: string): string {
  const rows = [...sources]
    .map((s) => ({
      id: s.id,
      url: s.url,
      retrievedAt: s.retrievedAt,
      contentHash: s.contentHash,
      etag: s.etag ?? "",
      lastModified: s.lastModified ?? "",
      publishDate: s.publishDate ?? "",
      byteLength: s.byteLength,
      recordCount: s.recordCount ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return sha256Hex(JSON.stringify({ retrievedAt, sources: rows }));
}

export function datasetVersionId(contentHash: string, generationHash: string): string {
  return `ofac-${contentHash.slice(0, 16)}-${generationHash.slice(0, 12)}`;
}
