"use client";

import type { ReactNode } from "react";
import { slugify } from "@/lib/docs";

function inline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link) {
      return (
        <a key={i} href={link[2]} className="text-cyan-200 underline underline-offset-2">
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function DocsMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        buf.push(lines[i]!);
        i += 1;
      }
      i += 1;
      const code = buf.join("\n");
      blocks.push(
        <div key={key++} className="group relative">
          <pre className="overflow-x-auto rounded-xl border border-white/8 bg-black/40 p-3 text-[12px]">
            <code>{code}</code>
          </pre>
          <Copy text={code} />
        </div>,
      );
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push(
        <aside key={key++} className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-[13px] text-amber-50">
          {inline(line.slice(2))}
        </aside>,
      );
      i += 1;
      continue;
    }
    if (line.startsWith("| ")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        const cells = lines[i]!.split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^[-:]+$/.test(c))) rows.push(cells);
        i += 1;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                {head?.map((c) => (
                  <th key={c} className="px-2 py-1 font-medium">
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-b border-white/5">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-2 py-1.5">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      const Tag = (`h${h[1]!.length}` as "h1" | "h2" | "h3");
      const text = h[2]!;
      blocks.push(
        <Tag key={key++} id={slugify(text.replace(/[`*]/g, ""))} className="scroll-mt-24 font-semibold tracking-tight">
          {inline(text)}
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) {
        items.push(lines[i]!.slice(2));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-[14px] text-zinc-300">
          {items.map((it, n) => (
            <li key={n}>{inline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    blocks.push(
      <p key={key++} className="text-[14px] leading-6 text-zinc-300">
        {inline(line)}
      </p>,
    );
    i += 1;
  }
  return <div className="docs-prose space-y-4">{blocks}</div>;
}

function Copy({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300 opacity-0 group-hover:opacity-100"
      onClick={() => navigator.clipboard.writeText(text)}
    >
      Copy
    </button>
  );
}
