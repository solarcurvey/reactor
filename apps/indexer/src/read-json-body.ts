/**
 * Bounded JSON body reader for public indexer POSTs.
 * Caps apply to Content-Length and to chunked Transfer-Encoding (no declared length).
 * The request is destroyed as soon as the cap is exceeded so the process never
 * buffers an unbounded body.
 */
import type { IncomingMessage } from "node:http";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 16 * 1024;

export function jsonBodyLimitBytes(): number {
  const n = Number(process.env.JSON_BODY_LIMIT_BYTES ?? DEFAULT_JSON_BODY_LIMIT_BYTES);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_JSON_BODY_LIMIT_BYTES;
  return Math.floor(n);
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
  const declared = declaredContentLength(req.headers);
  if (declared != null && declared > limit) {
    throw new BodyTooLargeError(limit);
  }

  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.length;
      if (received > limit) {
        req.pause();
        throw new BodyTooLargeError(limit);
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
