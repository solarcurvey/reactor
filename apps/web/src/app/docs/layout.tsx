import { DocsChrome } from "@/components/docs-chrome";
import { loadProtocolVersion } from "@/lib/docs";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const ver = loadProtocolVersion();
  return (
    <DocsChrome version={ver.protocolVersion} factoryLabel={ver.factoryVersionLabel}>
      {children}
    </DocsChrome>
  );
}
