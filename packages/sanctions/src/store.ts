import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { datasetContentHash, datasetVersionId, sourceGenerationHash } from "./hash.ts";
import { assessFreshness, parserCompatible, screen } from "./screen.ts";
import { PARSER_VERSION, type AddressFamily, type DatasetSnapshot, type DatasetVersion, type SanctionedAddress, type ScreenResult, type SourceCoverage, type SourceFetchMeta } from "./types.ts";

export type PersistedDataset = {
  version: DatasetVersion;
  addresses: SanctionedAddress[];
};

export type ActivateInput = {
  addresses: SanctionedAddress[];
  sources: SourceFetchMeta[];
  retrievedAt: string;
  warningCount: number;
  entryCount?: number;
};

/** Replacement must retain at least this fraction of last-known-good addresses (and per-source counts). */
export const DEFAULT_REJECT_IF_FEWER_THAN_PRIOR_RATIO = 0.85;
/** Source body must retain at least this fraction of the prior byte length (truncated-download guard). */
export const DEFAULT_REJECT_IF_SOURCE_BYTES_BELOW_PRIOR_RATIO = 0.5;
export const DEFAULT_MIN_ADDRESSES = 1;

export type ActivateValidation = {
  minAddresses?: number;
  rejectIfFewerThanPriorRatio?: number;
  rejectIfSourceBytesBelowPriorRatio?: number;
  /**
   * Explicit / manual override for a real OFAC shrink.
   * Production refresh must not set this. CLI: `--allow-shrink` or `SANCTIONS_ALLOW_SHRINK=1`.
   */
  allowCatastrophicShrink?: boolean;
};

export function resolveActivateValidation(v?: ActivateValidation): Required<ActivateValidation> {
  return {
    minAddresses: v?.minAddresses ?? DEFAULT_MIN_ADDRESSES,
    rejectIfFewerThanPriorRatio: v?.rejectIfFewerThanPriorRatio ?? DEFAULT_REJECT_IF_FEWER_THAN_PRIOR_RATIO,
    rejectIfSourceBytesBelowPriorRatio: v?.rejectIfSourceBytesBelowPriorRatio ?? DEFAULT_REJECT_IF_SOURCE_BYTES_BELOW_PRIOR_RATIO,
    allowCatastrophicShrink: v?.allowCatastrophicShrink ?? false,
  };
}

export function sourceCoverageOf(addresses: SanctionedAddress[], sources: SourceFetchMeta[]): SourceCoverage[] {
  const counts = new Map<string, number>();
  for (const a of addresses) {
    for (const s of a.sources) {
      counts.set(s.sourceId, (counts.get(s.sourceId) ?? 0) + 1);
    }
  }
  const seen = new Set<string>();
  const out: SourceCoverage[] = [];
  for (const s of sources) {
    seen.add(s.id);
    out.push({
      sourceId: s.id,
      addressCount: counts.get(s.id) ?? 0,
      byteLength: s.byteLength,
      recordCount: s.recordCount,
    });
  }
  for (const [id, n] of counts) {
    if (!seen.has(id)) out.push({ sourceId: id, addressCount: n, byteLength: 0 });
  }
  return out;
}

export function completenessError(
  input: { addresses: SanctionedAddress[]; sources: SourceFetchMeta[] },
  prior: DatasetSnapshot | null,
  validation?: ActivateValidation,
): string | null {
  const v = resolveActivateValidation(validation);
  if (input.addresses.length < v.minAddresses) {
    return `replacement has ${input.addresses.length} addresses; need ≥ ${v.minAddresses}`;
  }
  if (!prior || prior.version.addressCount <= 0 || v.allowCatastrophicShrink) return null;

  const floor = Math.ceil(prior.version.addressCount * v.rejectIfFewerThanPriorRatio);
  if (input.addresses.length < floor) {
    return `replacement has ${input.addresses.length} addresses; last-known-good has ${prior.version.addressCount} (floor ${floor} at ratio ${v.rejectIfFewerThanPriorRatio}). Set allowCatastrophicShrink for an explicit override`;
  }

  const priorCov =
    prior.version.sourceCoverage ?? sourceCoverageOf([...prior.index.values()], prior.version.sources);
  const nextById = new Map(sourceCoverageOf(input.addresses, input.sources).map((c) => [c.sourceId, c]));

  for (const prev of priorCov) {
    const next = nextById.get(prev.sourceId);
    if (!next) {
      return `replacement omitted source ${prev.sourceId} that last-known-good included. Set allowCatastrophicShrink for an explicit override`;
    }
    if (prev.addressCount > 0) {
      const srcFloor = Math.ceil(prev.addressCount * v.rejectIfFewerThanPriorRatio);
      if (next.addressCount < srcFloor) {
        return `source ${prev.sourceId} collapsed from ${prev.addressCount} to ${next.addressCount} addresses (floor ${srcFloor}). Set allowCatastrophicShrink for an explicit override`;
      }
    }
    if (prev.byteLength > 0) {
      const byteFloor = Math.ceil(prev.byteLength * v.rejectIfSourceBytesBelowPriorRatio);
      if (next.byteLength < byteFloor) {
        return `source ${prev.sourceId} body shrank from ${prev.byteLength} to ${next.byteLength} bytes (floor ${byteFloor}). Set allowCatastrophicShrink for an explicit override`;
      }
    }
  }
  return null;
}

export type ActivateResult =
  | { ok: true; snapshot: DatasetSnapshot }
  | { ok: false; error: string; preserved: DatasetSnapshot | null };

function snapshotFromPersisted(data: PersistedDataset): DatasetSnapshot {
  const index = new Map<string, SanctionedAddress>();
  for (const a of data.addresses) index.set(a.canonicalKey, a);
  return { version: data.version, index };
}

export class SanctionsStore {
  readonly dataDir: string;
  readonly maxAgeMs: number;
  readonly now: () => number;
  private current: DatasetSnapshot | null = null;

  constructor(opts: { dataDir: string; maxAgeMs?: number; now?: () => number }) {
    this.dataDir = opts.dataDir;
    this.maxAgeMs = opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  active(): DatasetSnapshot | null {
    return this.current;
  }

  loadFromDisk(): DatasetSnapshot | null {
    const pointer = join(this.dataDir, "current.json");
    if (!existsSync(pointer)) {
      this.current = null;
      return null;
    }
    let versionId: string;
    try {
      const p = JSON.parse(readFileSync(pointer, "utf8")) as { versionId?: string };
      if (!p.versionId) throw new Error("current.json missing versionId");
      versionId = p.versionId;
    } catch {
      this.current = null;
      return null;
    }
    const file = join(this.dataDir, "versions", versionId, "dataset.json");
    if (!existsSync(file)) {
      this.current = null;
      return null;
    }
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as PersistedDataset;
      if (!data.version?.id || !Array.isArray(data.addresses)) throw new Error("invalid dataset.json");
      if (!parserCompatible(data.version.parserVersion)) {
        this.current = null;
        return null;
      }
      if (!data.version.sourceCoverage) {
        data.version.sourceCoverage = sourceCoverageOf(data.addresses, data.version.sources ?? []);
      }
      if (!data.version.sourceGenerationHash) {
        data.version.sourceGenerationHash = sourceGenerationHash(data.version.sources ?? [], data.version.retrievedAt);
      }
      this.current = snapshotFromPersisted(data);
      return this.current;
    } catch {
      this.current = null;
      return null;
    }
  }

  /**
   * Validate the complete replacement, persist it, then atomically swing `current.json`.
   * Any failure leaves the last known-good pointer untouched.
   */
  activate(input: ActivateInput, validation: ActivateValidation = {}): ActivateResult {
    const prior = this.current ?? this.loadFromDisk();
    const completeErr = completenessError(input, prior, validation);
    if (completeErr) {
      return { ok: false, error: completeErr, preserved: prior };
    }

    const contentHash = datasetContentHash(input.addresses);
    const generationHash = sourceGenerationHash(input.sources, input.retrievedAt);
    const version: DatasetVersion = {
      id: datasetVersionId(contentHash, generationHash),
      retrievedAt: input.retrievedAt,
      sources: input.sources,
      sourceCoverage: sourceCoverageOf(input.addresses, input.sources),
      contentHash,
      sourceGenerationHash: generationHash,
      parserVersion: PARSER_VERSION,
      addressCount: input.addresses.length,
      entryCount: input.entryCount ?? input.addresses.length,
      warningCount: input.warningCount,
    };

    const tmpRoot = join(this.dataDir, "tmp", randomBytes(8).toString("hex"));
    const dest = join(this.dataDir, "versions", version.id);
    const persisted: PersistedDataset = { version, addresses: input.addresses };

    try {
      mkdirSync(tmpRoot, { recursive: true });
      writeFileSync(join(tmpRoot, "dataset.json"), JSON.stringify(persisted), "utf8");
      writeFileSync(join(tmpRoot, "version.json"), JSON.stringify(version, null, 2), "utf8");

      const reload = JSON.parse(readFileSync(join(tmpRoot, "dataset.json"), "utf8")) as PersistedDataset;
      if (reload.addresses.length !== input.addresses.length || reload.version.contentHash !== contentHash) {
        throw new Error("persisted dataset failed round-trip validation");
      }

      mkdirSync(dirname(dest), { recursive: true });
      if (existsSync(dest)) {
        const existing = JSON.parse(readFileSync(join(dest, "dataset.json"), "utf8")) as PersistedDataset;
        if (existing.version?.sourceGenerationHash !== generationHash || existing.version?.retrievedAt !== input.retrievedAt) {
          throw new Error("version id collision with different retrieval metadata");
        }
        rmSync(tmpRoot, { recursive: true, force: true });
      } else {
        renameSync(tmpRoot, dest);
      }

      const pointerTmp = join(this.dataDir, `current.json.${randomBytes(4).toString("hex")}.tmp`);
      writeFileSync(
        pointerTmp,
        JSON.stringify({
          versionId: version.id,
          retrievedAt: input.retrievedAt,
          sourceGenerationHash: generationHash,
          activatedAt: new Date(this.now()).toISOString(),
        }),
        "utf8",
      );
      renameSync(pointerTmp, join(this.dataDir, "current.json"));

      version.activatedAt = JSON.parse(readFileSync(join(this.dataDir, "current.json"), "utf8")).activatedAt;
      const snapshot = snapshotFromPersisted({ version, addresses: input.addresses });
      this.current = snapshot;
      return { ok: true, snapshot };
    } catch (e) {
      rmSync(tmpRoot, { recursive: true, force: true });
      this.current = prior;
      return { ok: false, error: e instanceof Error ? e.message : String(e), preserved: prior };
    }
  }

  screen(address: string, opts: { family?: AddressFamily } = {}): ScreenResult {
    return screen(address, this.current, { ...opts, maxAgeMs: this.maxAgeMs, now: this.now });
  }

  freshness() {
    return assessFreshness(this.current, { maxAgeMs: this.maxAgeMs, now: this.now });
  }
}

export function openSanctionsStore(opts: { dataDir: string; maxAgeMs?: number; now?: () => number }): SanctionsStore {
  const store = new SanctionsStore(opts);
  store.loadFromDisk();
  return store;
}
