/** Same default / hard max as indexer `read-json-body.ts` — public JSON POSTs. */
export const JSON_BODY_LIMIT_BYTES = 16 * 1024;
export const MAX_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {
  readonly status = 413;
  constructor(limit: number = JSON_BODY_LIMIT_BYTES) {
    super(`request body too large (${limit} byte JSON limit)`);
    this.name = "BodyTooLargeError";
  }
}

export async function readLimitedText(
  req: Request,
  limit: number = JSON_BODY_LIMIT_BYTES,
): Promise<string> {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), MAX_JSON_BODY_LIMIT_BYTES) : JSON_BODY_LIMIT_BYTES;
  const raw = req.headers.get("content-length");
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > cap) throw new BodyTooLargeError(cap);
  }
  const stream = req.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > cap) throw new BodyTooLargeError(cap);
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  if (chunks.length === 0) return "";
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}
