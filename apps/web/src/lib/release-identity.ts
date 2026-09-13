import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseIdentity = {
  protocolVersion: string;
  factoryVersion: number;
  factoryVersionLabel: string;
  releaseTag: string;
  apiVersion: string;
  sdkVersion: string;
  coreVersion: string;
  sourceRelease: string;
};

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function repoRoot(): string {
  const fromHere = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const candidates = [fromHere, process.cwd(), join(process.cwd(), ".."), join(process.cwd(), "..", "..")];
  for (const c of candidates) {
    if (existsSync(join(c, "docs", "version.json"))) return c;
  }
  return candidates[0]!;
}

export function loadReleaseIdentity(root = repoRoot()): ReleaseIdentity {
  const ver = readJson<{
    protocolVersion: string;
    factoryVersion: number;
    factoryVersionLabel: string;
    releaseTag: string;
  }>(join(root, "docs", "version.json"));
  const rootPkg = readJson<{ version?: string }>(join(root, "package.json"));
  const api = readJson<{ version?: string }>(join(root, "apps", "indexer", "package.json"));
  const sdk = readJson<{ version?: string }>(join(root, "packages", "sdk", "package.json"));
  const core = readJson<{ version?: string }>(join(root, "packages", "reactor", "package.json"));
  return {
    protocolVersion: ver.protocolVersion,
    factoryVersion: ver.factoryVersion,
    factoryVersionLabel: ver.factoryVersionLabel,
    releaseTag: ver.releaseTag,
    apiVersion: api.version ?? ver.protocolVersion,
    sdkVersion: sdk.version ?? ver.protocolVersion,
    coreVersion: core.version ?? ver.protocolVersion,
    sourceRelease: rootPkg.version ? `v${rootPkg.version}` : ver.releaseTag,
  };
}

export function applyReleaseTokens(md: string, rel: ReleaseIdentity): string {
  return md
    .replaceAll("{{protocolVersion}}", rel.protocolVersion)
    .replaceAll("{{releaseTag}}", rel.releaseTag)
    .replaceAll("{{factoryVersionLabel}}", rel.factoryVersionLabel)
    .replaceAll("{{factoryVersion}}", String(rel.factoryVersion))
    .replaceAll("{{apiVersion}}", rel.apiVersion)
    .replaceAll("{{sdkVersion}}", rel.sdkVersion)
    .replaceAll("{{coreVersion}}", rel.coreVersion)
    .replaceAll("{{sourceRelease}}", rel.sourceRelease);
}
