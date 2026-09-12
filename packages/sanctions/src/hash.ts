import { createHash } from "node:crypto";
import type { SanctionedAddress } from "./types.ts";

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
