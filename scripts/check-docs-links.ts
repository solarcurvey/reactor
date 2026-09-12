#!/usr/bin/env npx tsx
/**
 * Fail CI on broken handbook links.
 * Internal: /docs slugs and repo-relative markdown files.
 * External: live http(s) URLs. Localhost examples are skipped.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS, docHref } from "../apps/web/src/lib/docs-nav.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

const handbookHrefs = new Set(DOCS.map((d) => docHref(d.slug)));

function isLocalExample(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost";
  } catch {
    return false;
  }
}

function isPlaceholder(href: string): boolean {
  return href.includes("…") || href.includes("...") || href.includes("<") || href.endsWith("cdn…/m/<id>.webp");
}

function scanFiles(): string[] {
  const docsDir = join(root, "docs");
  const files = readdirSync(docsDir)
    .filter((f) => f.endsWith(".md") || f === "llms.txt")
    .map((f) => join(docsDir, f));
  files.push(join(root, "CHANGELOG.md"), join(root, "CONTRIBUTING.md"), join(root, "README.md"));
  return files.filter((f) => existsSync(f));
}

type Found = { file: string; href: string };

function collect(file: string): Found[] {
  const rel = file.slice(root.length + 1);
  const text = readFileSync(file, "utf8");
  const out: Found[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    out.push({ file: rel, href: m[2]!.trim() });
  }
  return out;
}

function checkInternal(file: string, href: string): string | null {
  const pathPart = href.split("#")[0] ?? "";
  if (!pathPart) return null;
  if (pathPart.startsWith("mailto:") || pathPart.startsWith("tel:")) return null;
  if (pathPart.startsWith("http://") || pathPart.startsWith("https://")) return null;

  if (pathPart.startsWith("/docs")) {
    const normalized = pathPart.replace(/\/$/, "") || "/docs";
    if (!handbookHrefs.has(normalized) && !handbookHrefs.has(pathPart)) {
      return `${file}: unknown handbook path ${pathPart}`;
    }
    return null;
  }

  const fromDir = dirname(join(root, file));
  const candidates = [resolve(fromDir, pathPart), join(root, pathPart)];
  if (candidates.some((p) => existsSync(p))) return null;
  return `${file}: missing file ${pathPart}`;
}

async function checkExternal(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  const headers = { "user-agent": "reactor-docs-link-check/1" };
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers });
    if (res.status === 405 || res.status === 403 || res.status === 401 || res.status === 429) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers });
    }
    if (res.status >= 400) return `${url} → HTTP ${res.status}`;
    return null;
  } catch (e) {
    return `${url} → ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const errors: string[] = [];
  const externals = new Set<string>();
  for (const file of scanFiles()) {
    for (const { file: rel, href } of collect(file)) {
      if (isPlaceholder(href)) continue;
      if (href.startsWith("http://") || href.startsWith("https://")) {
        if (isLocalExample(href)) continue;
        externals.add(href);
        continue;
      }
      const err = checkInternal(rel, href);
      if (err) errors.push(err);
    }
  }

  const extResults = await Promise.all([...externals].map(async (url) => ({ url, err: await checkExternal(url) })));
  for (const { err } of extResults) {
    if (err) errors.push(`external: ${err}`);
  }

  if (errors.length) {
    console.error("docs link check FAILED:");
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`docs links ok (${externals.size} external, handbook slugs ${handbookHrefs.size})`);
}

void main();
