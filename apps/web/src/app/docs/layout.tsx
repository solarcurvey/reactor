"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { DOCS } from "@/lib/docs-nav";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<string, typeof DOCS>();
    for (const d of DOCS) {
      if (needle && !`${d.title} ${d.slug}`.toLowerCase().includes(needle)) continue;
      const arr = map.get(d.group) ?? [];
      arr.push(d);
      map.set(d.group, arr);
    }
    return [...map.entries()];
  }, [q]);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <p className="text-[11px] uppercase tracking-[0.12em] text-rx-cool">Docs · 0.3.3</p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search docs"
          className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[13px]"
        />
        <nav className="mt-3 space-y-3 text-[13px]">
          {groups.map(([g, items]) => (
            <div key={g}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">{g}</div>
              <ul className="mt-1 space-y-0.5">
                {items.map((d) => {
                  const href = d.slug ? `/docs/${d.slug}` : "/docs";
                  const on = path === href;
                  return (
                    <li key={d.file}>
                      <Link href={href} className={`block rounded-md px-2 py-1 ${on ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}>
                        {d.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div>{children}</div>
    </div>
  );
}
