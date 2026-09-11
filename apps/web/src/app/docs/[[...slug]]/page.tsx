import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsMarkdown } from "@/components/docs-md";
import { DOCS, headings, loadDoc, loadProtocolVersion } from "@/lib/docs";

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug ? [d.slug] : [] }));
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = (await params).slug?.[0] ?? "";
  const doc = loadDoc(slug);
  if (!doc) notFound();
  const toc = headings(doc.markdown);
  const ver = loadProtocolVersion();
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_180px]">
      <article>
        <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
          <Link href="/docs" className="hover:text-white">
            Docs
          </Link>
        </p>
        <DocsMarkdown source={doc.markdown} />
        <p className="mt-10 text-[11px] text-zinc-600">
          Protocol {ver.protocolVersion} ({ver.releaseTag}). Factory {ver.factoryVersionLabel}. Not audited. No public
          mainnet. Constants must match ReactorConstants.
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
