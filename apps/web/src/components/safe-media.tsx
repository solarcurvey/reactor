import { sanitizeMediaUrl } from "@/lib/untrusted-metadata";

export function SafeTokenImage({
  src,
  alt = "",
  className,
}: {
  src?: string;
  alt?: string;
  className?: string;
}) {
  const safe = sanitizeMediaUrl(src);
  if (!safe) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={safe} alt={alt} className={className} referrerPolicy="no-referrer" draggable={false} />
  );
}
