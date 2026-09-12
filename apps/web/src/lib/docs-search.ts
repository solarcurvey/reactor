import type { DocNav } from "./docs-nav";

export type DocsSearchEntry = {
  slug: string;
  title: string;
  group: string;
  file: string;
  blurb: string;
  keywords: string;
  body: string;
};

export function buildSearchEntry(meta: DocNav, markdown: string): DocsSearchEntry {
  return {
    slug: meta.slug,
    title: meta.title,
    group: meta.group,
    file: meta.file,
    blurb: meta.blurb,
    keywords: meta.keywords,
    body: markdown,
  };
}

export function searchHaystack(entry: DocsSearchEntry): string {
  return `${entry.title}\n${entry.slug}\n${entry.group}\n${entry.blurb}\n${entry.keywords}\n${entry.body}`.toLowerCase();
}

export function navHaystack(entry: Pick<DocsSearchEntry, "title" | "slug" | "group" | "blurb" | "keywords">): string {
  return `${entry.title} ${entry.slug} ${entry.group} ${entry.blurb} ${entry.keywords}`.toLowerCase();
}

export function searchDocs(entries: DocsSearchEntry[], query: string): DocsSearchEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((e) => searchHaystack(e).includes(needle));
}
