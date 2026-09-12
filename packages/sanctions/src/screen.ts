import { candidateKeys } from "./normalize.ts";
import { PARSER_VERSION, SCREEN_DISCLAIMER, type AddressFamily, type DatasetSnapshot, type DatasetVersion, type Freshness, type ScreenResult } from "./types.ts";

export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function parserMajor(version: string): string {
  return version.split(".")[0] ?? "";
}

export function parserCompatible(version: string): boolean {
  return parserMajor(version) === parserMajor(PARSER_VERSION);
}

export function assessFreshness(
  snapshot: DatasetSnapshot | null,
  opts: { maxAgeMs?: number; now?: () => number } = {},
): Freshness {
  if (!snapshot) return "missing";
  if (!parserCompatible(snapshot.version.parserVersion)) return "missing";
  const now = (opts.now ?? Date.now)();
  const retrieved = Date.parse(snapshot.version.retrievedAt);
  if (!Number.isFinite(retrieved)) return "stale";
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  return now - retrieved > maxAge ? "stale" : "current";
}

export function screen(
  address: string,
  snapshot: DatasetSnapshot | null,
  opts: { family?: AddressFamily; maxAgeMs?: number; now?: () => number } = {},
): ScreenResult {
  const version: DatasetVersion | null = snapshot?.version ?? null;
  if (!snapshot) {
    return {
      decision: "unavailable",
      reason: "missing_dataset",
      freshness: "missing",
      datasetVersion: null,
      match: null,
      disclaimer: SCREEN_DISCLAIMER,
    };
  }
  if (!parserCompatible(snapshot.version.parserVersion)) {
    return {
      decision: "unavailable",
      reason: "incompatible_parser",
      freshness: "missing",
      datasetVersion: version,
      match: null,
      disclaimer: SCREEN_DISCLAIMER,
    };
  }

  const freshness = assessFreshness(snapshot, opts);
  const keys = candidateKeys(address, opts.family);
  if (keys.length === 0) {
    return {
      decision: "unavailable",
      reason: "invalid_query",
      freshness,
      datasetVersion: version,
      match: null,
      disclaimer: SCREEN_DISCLAIMER,
    };
  }

  for (const key of keys) {
    const hit = snapshot.index.get(key);
    if (hit) {
      return {
        decision: "blocked",
        freshness,
        datasetVersion: version,
        match: {
          family: hit.family,
          canonicalKey: hit.canonicalKey,
          display: hit.display,
          ofacTickers: hit.ofacTickers,
          sdnUids: hit.sdnUids,
          names: hit.names,
          sources: hit.sources,
        },
        disclaimer: SCREEN_DISCLAIMER,
      };
    }
  }

  if (freshness === "stale") {
    return {
      decision: "unavailable",
      reason: "stale_dataset",
      freshness: "stale",
      datasetVersion: version,
      match: null,
      disclaimer: SCREEN_DISCLAIMER,
    };
  }

  return {
    decision: "clear",
    freshness: "current",
    datasetVersion: version,
    match: null,
    disclaimer: SCREEN_DISCLAIMER,
  };
}
