#!/usr/bin/env npx tsx
/**
 * Deterministic in-repo docs link check. No network.
 *
 * Resolves:
 *   - /docs and /docs/<slug>[#anchor] against docs-nav + heading ids
 *   - relative paths against the source file, then the repo root
 *   - same-file #anchors via the same slugify as the docs renderer
 *
 * Skips http(s), mailto, and other schemes so CI cannot flake on the public web.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS, slugify } from "../apps/web/src/lib/docs-nav.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;

export type LinkHit = { file: string; href: string; line: number };

function stripFences(md: string): string {
  return md.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "));
}

export function extractLinks(md: string, file: string): LinkHit[] {
  const body = stripFences(md);
  const out: LinkHit[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINK_RE.exec(line))) {
      out.push({ file, href: m[1]!.trim(), line: i + 1 });
    }
  }
  return out;
}

function headings(md: string): Set<string> {
  const ids = new Set<string>();
  for (const line of md.split("\n")) {
    if (line.startsWith("<!--")) continue;
    const m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (!m) continue;
    ids.add(slugify(m[2]!.replace(/[`*]/g, "")));
  }
  return ids;
}

function slugToFile(slug: string): string | undefined {
  return DOCS.find((d) => d.slug === slug)?.file;
}

function existsUnderRoot(abs: string): boolean {
  const norm = resolve(abs);
  const rel = relative(resolve(root), norm);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) return false;
  return existsSync(norm);
}

function headingOk(fileAbs: string, anchor: string): boolean {
  if (!anchor) return true;
  if (!existsSync(fileAbs)) return false;
  return headings(readFileSync(fileAbs, "utf8")).has(anchor);
}

export function resolveDocHref(fromFile: string, href: string): string | null {
  if (!href || href.startsWith("?") || href.startsWith("//")) {
    return `empty or protocol-relative link`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("file:")) {
    return null;
  }

  const hash = href.indexOf("#");
  const pathPart = hash === -1 ? href : href.slice(0, hash);
  const anchor = hash === -1 ? "" : href.slice(hash + 1);

  if (!pathPart || pathPart === "#") {
    const abs = join(root, fromFile);
    if (!headingOk(abs, anchor)) return `missing heading #${anchor}`;
    return null;
  }

  if (pathPart === "/docs" || pathPart === "/docs/") {
    const file = slugToFile("");
    if (!file) return `unknown docs slug ""`;
    const abs = join(root, "docs", file);
    if (!existsSync(abs)) return `missing docs/${file}`;
    if (!headingOk(abs, anchor)) return `missing heading #${anchor} on /docs`;
    return null;
  }

  if (pathPart.startsWith("/docs/")) {
    const slug = pathPart.slice("/docs/".length).replace(/\/$/, "");
    if (slug.includes("/")) return `nested /docs path is not a docs-nav slug: ${pathPart}`;
    const file = slugToFile(slug);
    if (!file) return `unknown docs slug "${slug}"`;
    const abs = join(root, "docs", file);
    if (!existsSync(abs)) return `missing docs/${file}`;
    if (!headingOk(abs, anchor)) return `missing heading #${anchor} on /docs/${slug}`;
    return null;
  }

  if (pathPart.startsWith("/")) {
    return `in-app path is not a docs page or repo file: ${pathPart}`;
  }

  const fromAbs = join(root, fromFile);
  const candidates = [resolve(dirname(fromAbs), pathPart), resolve(root, pathPart)];
  for (const abs of candidates) {
    if (existsUnderRoot(abs) && statSync(abs).isFile()) {
      if (anchor && abs.endsWith(".md") && !headingOk(abs, anchor)) {
        return `missing heading #${anchor} in ${relative(root, abs)}`;
      }
      return null;
    }
  }
  return `missing file ${pathPart}`;
}

function listDocMarkdown(): string[] {
  return readdirSync(join(root, "docs"))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join("docs", name));
}

export function checkDocsLinks(): string[] {
  const errors: string[] = [];
  const navFiles = new Set(DOCS.map((d) => d.file));
  for (const d of DOCS) {
    const abs = join(root, "docs", d.file);
    if (!existsSync(abs)) errors.push(`docs-nav: missing docs/${d.file} (slug "${d.slug}")`);
  }
  for (const file of listDocMarkdown()) {
    const name = file.slice("docs/".length);
    if (!navFiles.has(name)) errors.push(`docs/${name} is not in docs-nav.ts`);
  }
  for (const file of listDocMarkdown()) {
    const md = readFileSync(join(root, file), "utf8");
    for (const hit of extractLinks(md, file)) {
      const err = resolveDocHref(file, hit.href);
      if (err) errors.push(`${file}:${hit.line} [${hit.href}] ${err}`);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkDocsLinks();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("docs links ok");
}
