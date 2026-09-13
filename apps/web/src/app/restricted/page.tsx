import { parseUxKind } from "@/lib/operator-policy";
import { RestrictedView } from "./restricted-view";

export const dynamic = "force-dynamic";

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Server entry so `?kind=` is in the RSC payload. The client view must not read
 * the URL on the client during render — that suspends behind a text fallback
 * and flakes React #418 (hydration text/HTML) on production `next start`.
 */
export default async function RestrictedPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  const params = await searchParams;
  return <RestrictedView initialKind={parseUxKind(firstQueryValue(params.kind))} />;
}
