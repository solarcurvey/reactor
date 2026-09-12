import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { datasetContentHash } from "./hash.ts";
import { assessFreshness, parserCompatible, screen } from "./screen.ts";
import { PARSER_VERSION, type AddressFamily, type DatasetSnapshot, type DatasetVersion, type SanctionedAddress, type ScreenResult, type SourceFetchMeta } from "./types.ts";

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

export type ActivateValidation = {
  minAddresses?: number;
  rejectIfFewerThanPriorRatio?: number;
};

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
    const minAddresses = validation.minAddresses ?? 1;
    const ratio = validation.rejectIfFewerThanPriorRatio ?? 0.1;

    if (input.addresses.length < minAddresses) {
      return { ok: false, error: `replacement has ${input.addresses.length} addresses; need ≥ ${minAddresses}`, preserved: prior };
    }
    if (prior && prior.version.addressCount > 0) {
      const floor = Math.ceil(prior.version.addressCount * ratio);
      if (input.addresses.length < floor) {
        return {
          ok: false,
          error: `replacement has ${input.addresses.length} addresses; last-known-good has ${prior.version.addressCount} (floor ${floor})`,
          preserved: prior,
        };
      }
    }

    const contentHash = datasetContentHash(input.addresses);
    const version: DatasetVersion = {
      id: `ofac-${contentHash.slice(0, 16)}`,
      retrievedAt: input.retrievedAt,
      sources: input.sources,
      contentHash,
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
        rmSync(tmpRoot, { recursive: true, force: true });
      } else {
        renameSync(tmpRoot, dest);
      }

      const pointerTmp = join(this.dataDir, `current.json.${randomBytes(4).toString("hex")}.tmp`);
      writeFileSync(pointerTmp, JSON.stringify({ versionId: version.id, activatedAt: new Date(this.now()).toISOString() }), "utf8");
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
