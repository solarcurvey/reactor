import { sha256Hex } from "./hash.ts";
import { assertOfficialSourceUrl } from "./sources.ts";
import type { OfficialSource, SourceFetchMeta } from "./types.ts";

export const DEFAULT_FETCH_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

export type FetchedSource = {
  meta: SourceFetchMeta;
  body: string;
};

export type FetchOfficialOpts = {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
};

function header(res: Response, name: string): string | undefined {
  const v = res.headers.get(name);
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Download one allowlisted official HTTPS source.
 * Redirects are followed only while the next URL remains an official Treasury/OFAC host.
 */
export async function fetchOfficialSource(source: OfficialSource, opts: FetchOfficialOpts = {}): Promise<FetchedSource> {
  assertOfficialSourceUrl(source.url);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retrievedAt = new Date().toISOString();

  const res = await fetchImpl(source.url, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/xml,text/xml,application/octet-stream,*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  let final = res;
  let hops = 0;
  while (final.status >= 300 && final.status < 400 && hops < 5) {
    const loc = header(final, "location");
    if (!loc) throw new Error(`${source.id}: redirect without Location`);
    const next = new URL(loc, source.url);
    assertOfficialSourceUrl(next.toString());
    hops += 1;
    final = await fetchImpl(next.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/xml,text/xml,application/octet-stream,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  if (!final.ok) {
    throw new Error(`${source.id}: HTTP ${final.status} from ${source.url}`);
  }

  const buf = new Uint8Array(await final.arrayBuffer());
  if (buf.byteLength === 0) throw new Error(`${source.id}: empty body`);
  if (buf.byteLength > maxBytes) throw new Error(`${source.id}: body exceeds ${maxBytes} bytes`);

  const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return {
    body,
    meta: {
      id: source.id,
      url: source.url,
      format: source.format,
      retrievedAt,
      contentHash: sha256Hex(buf),
      byteLength: buf.byteLength,
      httpStatus: final.status,
      etag: header(final, "etag"),
      lastModified: header(final, "last-modified"),
    },
  };
}
