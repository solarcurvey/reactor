import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsMarkdown } from "@/components/docs-md";
import { adjacentDocs, docHref } from "@/lib/docs-nav";
import { DOCS, headings, loadDoc, loadRelease } from "@/lib/docs";

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug ? [d.slug] : [] }));
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = (await params).slug?.[0] ?? "";
  const doc = loadDoc(slug);
  if (!doc) notFound();
  const toc = headings(doc.markdown);
  const ver = loadRelease();
  const { prev, next } = adjacentDocs(slug);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_180px]">
      <article>
        <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400">
          <Link href="/docs" className="hover:text-white">
            Docs
          </Link>
        </p>
        <DocsMarkdown source={doc.markdown} />
        <nav className="mt-10 grid gap-3 border-t border-white/8 pt-6 text-[13px] sm:grid-cols-2">
          {prev ? (
            <Link href={docHref(prev.slug)} className="rounded-lg border border-white/8 px-3 py-2 text-zinc-400 hover:text-white">
              Previous
              <span className="mt-0.5 block text-white">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={docHref(next.slug)} className="rounded-lg border border-white/8 px-3 py-2 text-right text-zinc-400 hover:text-white">
              Next
              <span className="mt-0.5 block text-white">{next.title}</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
        <p className="mt-10 text-[11px] text-zinc-400" data-testid="docs-footer-badges">
          Protocol {ver.protocolVersion} ({ver.releaseTag}). Factory {ver.factoryVersionLabel}. API {ver.apiVersion}. SDK{" "}
          {ver.sdkVersion}. Source {ver.sourceRelease}. Not audited. No public mainnet. Constants must match
          ReactorConstants.
        </p>
      </article>
      <aside className="hidden lg:block">
        <div className="sticky top-20 text-[12px] text-zinc-500">
          <div className="uppercase tracking-wider">On this page</div>
          <ul className="mt-2 space-y-1">
            {toc.map((h) => (
              <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
                <a href={`#${h.id}`} className="hover:text-white">
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
