"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { DOCS, docHref } from "@/lib/docs-nav";
import { searchDocs, type DocsSearchEntry } from "@/lib/docs-search";
import type { ReleaseIdentity } from "@/lib/release-identity";

export function DocsChrome({
  release,
  searchIndex,
  children,
}: {
  release: ReleaseIdentity;
  searchIndex: DocsSearchEntry[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const hits = new Set(searchDocs(searchIndex, q).map((e) => e.file));
    const map = new Map<string, typeof DOCS>();
    for (const d of DOCS) {
      if (q.trim() && !hits.has(d.file)) continue;
      const arr = map.get(d.group) ?? [];
      arr.push(d);
      map.set(d.group, arr);
    }
    return [...map.entries()];
  }, [q, searchIndex]);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <p className="rx-kicker" data-testid="docs-version-badges">
          <span data-testid="badge-protocol">Protocol {release.protocolVersion}</span>
          {" · "}
          <span data-testid="badge-factory">Factory {release.factoryVersionLabel}</span>
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500" data-testid="docs-release-badges">
          <span data-testid="badge-api">API {release.apiVersion}</span>
          {" · "}
          <span data-testid="badge-sdk">SDK {release.sdkVersion}</span>
          {" · "}
          <span data-testid="badge-source">Source {release.sourceRelease}</span>
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search handbook"
          aria-label="Search handbook"
          data-testid="docs-search"
          className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[13px]"
        />
        <nav className="mt-3 space-y-3 text-[13px]" data-testid="docs-sidebar">
          {groups.map(([g, items]) => (
            <div key={g}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">{g}</div>
              <ul className="mt-1 space-y-0.5">
                {items.map((d) => {
                  const href = docHref(d.slug);
                  const on = path === href;
                  return (
                    <li key={d.file}>
                      <Link
                        href={href}
                        className={`block rounded-md px-2 py-1 ${on ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}
                      >
                        {d.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        {q.trim() && groups.length === 0 ? (
          <p className="mt-3 text-[12px] text-zinc-500">No handbook pages match that search.</p>
        ) : null}
      </aside>
      <div>{children}</div>
    </div>
  );
}
