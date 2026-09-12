import type { ReactNode } from "react";
import { sanitizeDocHref, sanitizeExternalUrl } from "@/lib/untrusted-metadata";

export function SafeExternalLink({
  href,
  children,
  className,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const safe = href ? sanitizeExternalUrl(href) : null;
  if (!safe) return null;
  return (
    <a href={safe} className={className} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

export function SafeDocLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const safe = sanitizeDocHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  const external = safe.startsWith("https://") || safe.startsWith("http://");
  return (
    <a
      href={safe}
      className={className}
      {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
    >
      {children}
    </a>
  );
}
