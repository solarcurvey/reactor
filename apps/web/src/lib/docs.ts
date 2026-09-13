import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DOCS, slugify } from "./docs-nav";
import { buildSearchEntry, type DocsSearchEntry } from "./docs-search";
import { applyReleaseTokens, loadReleaseIdentity, type ReleaseIdentity } from "./release-identity";

export { DOCS, slugify };
export type { DocsSearchEntry, ReleaseIdentity };

export type ProtocolVersion = {
  protocolVersion: string;
  factoryVersion: number;
  factoryVersionLabel: string;
  releaseTag: string;
};

export function loadProtocolVersion(): ProtocolVersion {
  const rel = loadReleaseIdentity();
  return {
    protocolVersion: rel.protocolVersion,
    factoryVersion: rel.factoryVersion,
    factoryVersionLabel: rel.factoryVersionLabel,
    releaseTag: rel.releaseTag,
  };
}

export function loadRelease(): ReleaseIdentity {
  return loadReleaseIdentity();
}

export function docsRoot(): string {
  const candidates = [
    join(process.cwd(), "docs"),
    join(process.cwd(), "..", "docs"),
    join(process.cwd(), "..", "..", "docs"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "index.md"))) return c;
  }
  return candidates[0]!;
}

export function loadDoc(slug: string): { title: string; markdown: string } | null {
  const meta = DOCS.find((d) => d.slug === slug);
  if (!meta) return null;
  const p = join(docsRoot(), meta.file);
  if (!existsSync(p)) return null;
  const rel = loadReleaseIdentity();
  return { title: meta.title, markdown: applyReleaseTokens(readFileSync(p, "utf8"), rel) };
}

export function loadDocsSearchIndex(): DocsSearchEntry[] {
  const rel = loadReleaseIdentity();
  const root = docsRoot();
  return DOCS.map((meta) => {
    const p = join(root, meta.file);
    const raw = existsSync(p) ? readFileSync(p, "utf8") : "";
    return buildSearchEntry(meta, applyReleaseTokens(raw, rel));
  });
}

export function headings(md: string): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  for (const line of md.split("\n")) {
    if (line.startsWith("<!--")) continue;
    const m = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/[`*]/g, "");
    out.push({ id: slugify(text), text, level: m[1]!.length });
  }
  return out;
}
