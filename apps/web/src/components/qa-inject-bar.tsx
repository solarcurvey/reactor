"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseQaInject, parseQaState, qaInjectEnabled } from "@/lib/qa-inject";

const QUOTE_TOKEN = "0x1111111111111111111111111111111111110001";

const LINKS: { href: string; label: string }[] = [
  { href: "/?inject=indexer", label: "Indexer" },
  { href: "/core?inject=rpc", label: "RPC" },
  { href: `/token/${QUOTE_TOKEN}?inject=quote-429`, label: "Quote 429" },
  { href: `/token/${QUOTE_TOKEN}?inject=quote-stale`, label: "Stale quote" },
  { href: "/launch?inject=pricing", label: "Pricing" },
  { href: "/launch?inject=upload", label: "Upload" },
  { href: "/?inject=sse", label: "SSE" },
  { href: "/?inject=empty", label: "Empty" },
  { href: "/?inject=wallet-reject", label: "Wallet" },
];

export function QaInjectBar() {
  const params = useSearchParams();
  if (!qaInjectEnabled()) return null;
  const search = `?${params.toString()}`;
  const inject = parseQaInject(search);
  const state = parseQaState(search);
  const show = params.get("qa") === "1" || inject !== null || state !== null;
  if (!show) return null;

  return (
    <div
      role="region"
      aria-label="Failure injection"
      data-testid="qa-inject-bar"
      className="border-b border-amber-300/30 bg-amber-300/10 px-3 py-2 text-center text-[12px] text-amber-50"
    >
      <p>
        QA inject (review / QA-build only) ·{" "}
        {LINKS.map((l, i) => (
          <span key={l.href}>
            {i > 0 ? " · " : null}
            <Link className="underline hover:text-white" href={l.href}>
              {l.label}
            </Link>
          </span>
        ))}
        {" · "}
        <Link className="underline hover:text-white" href="/">
          Clear
        </Link>
        {inject ? ` · active: ${inject}` : ""}
        {state ? ` · state: ${state}` : ""}
      </p>
    </div>
  );
}
