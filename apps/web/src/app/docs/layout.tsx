import { DocsChrome } from "@/components/docs-chrome";
import { loadDocsSearchIndex, loadRelease } from "@/lib/docs";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const release = loadRelease();
  const searchIndex = loadDocsSearchIndex();
  return (
    <DocsChrome release={release} searchIndex={searchIndex}>
      {children}
    </DocsChrome>
  );
}
