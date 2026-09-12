"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { DOCS, docHref } from "@/lib/docs-nav";

export function DocsChrome({
  version,
  factoryLabel,
  children,
}: {
  version: string;
  factoryLabel: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<string, typeof DOCS>();
    for (const d of DOCS) {
      const hay = `${d.title} ${d.slug} ${d.group} ${d.blurb} ${d.keywords}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      const arr = map.get(d.group) ?? [];
      arr.push(d);
      map.set(d.group, arr);
    }
    return [...map.entries()];
  }, [q]);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">
          Docs · {version} · {factoryLabel}
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search handbook"
          aria-label="Search handbook"
          className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[13px]"
        />
        <nav className="mt-3 space-y-3 text-[13px]">
          {groups.map(([g, items]) => (
            <div key={g}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{g}</div>
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
