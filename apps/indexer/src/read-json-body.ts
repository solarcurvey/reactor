/**
 * Bounded JSON body reader for public indexer POSTs.
 * Caps apply to Content-Length and to chunked Transfer-Encoding (no declared length).
 * The request is destroyed as soon as the cap is exceeded so the process never
 * buffers an unbounded body.
 */
import type { IncomingMessage } from "node:http";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 16 * 1024;
/** Hard ceiling. `JSON_BODY_LIMIT_BYTES` cannot raise the cap above this. */
export const MAX_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export function clampJsonBodyLimit(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return DEFAULT_JSON_BODY_LIMIT_BYTES;
  return Math.min(Math.floor(bytes), MAX_JSON_BODY_LIMIT_BYTES);
}

export function jsonBodyLimitBytes(): number {
  return clampJsonBodyLimit(Number(process.env.JSON_BODY_LIMIT_BYTES ?? DEFAULT_JSON_BODY_LIMIT_BYTES));
}

export class BodyTooLargeError extends Error {
  readonly status = 413;
  readonly limit: number;
  constructor(limit: number = jsonBodyLimitBytes()) {
    super(`request body too large (${limit} byte JSON limit)`);
    this.name = "BodyTooLargeError";
    this.limit = limit;
  }
}

export function declaredContentLength(headers: IncomingMessage["headers"]): number | null {
  const raw = headers["content-length"];
  if (raw == null) return null;
  const parts = Array.isArray(raw) ? raw : [raw];
  let first: number | null = null;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) return null;
    if (first == null) first = n;
    else if (n !== first) return null;
  }
  return first;
}

export function abortIncoming(req: IncomingMessage) {
  try {
    req.pause();
    req.destroy();
  } catch {
    /* already closed */
  }
}

export async function readLimitedBuffer(
  req: IncomingMessage,
  limit: number = jsonBodyLimitBytes(),
): Promise<Buffer> {
  const cap = clampJsonBodyLimit(limit);
  const declared = declaredContentLength(req.headers);
  if (declared != null && declared > cap) {
    throw new BodyTooLargeError(cap);
  }

  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.length;
      if (received > cap) {
        req.pause();
        throw new BodyTooLargeError(cap);
      }
      chunks.push(buf);
    }
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw e;
    abortIncoming(req);
    throw e;
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
}

export async function readJsonBody(
  req: IncomingMessage,
  limit: number = jsonBodyLimitBytes(),
): Promise<Record<string, unknown>> {
  const raw = (await readLimitedBuffer(req, limit)).toString("utf8").trim();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("JSON body must be an object");
  }
  return parsed as Record<string, unknown>;
}
