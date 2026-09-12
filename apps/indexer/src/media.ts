import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import sharp from "sharp";
import { s3PutSigV4 } from "./s3-sigv4.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIM = 2048;
const TARGET = 512;

export type StoredMedia = { id: string; uri: string; contentType: string; bytes: number };

/** Public path returned by `put()` and served at `GET /m/<id>.webp`. */
export function mediaPublicUri(id: string): string {
  return `/m/${id}.webp`;
}

/**
 * R2/S3 object key for a content id. Equal to the public URI without the leading slash
 * so `MEDIA_CDN_BASE + uri` resolves to the uploaded object (`m/<id>.webp`, not bare `<id>`).
 */
export function mediaObjectKey(id: string): string {
  return mediaPublicUri(id).slice(1);
}

/** Fail closed if a remote key would not be the path of the returned public URI. */
export function assertMediaKeyMatchesPublicUri(key: string, uri: string): void {
  const expected = uri.startsWith("/") ? uri.slice(1) : uri;
  if (!uri.startsWith("/m/") || !uri.endsWith(".webp") || key !== expected) {
    throw new Error(`media object key ${key} does not match public uri ${uri}`);
  }
}

function magic(buf: Buffer): "jpeg" | "png" | "webp" | "gif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  if (buf.slice(0, 3).toString() === "GIF") return "gif";
  return null;
}

function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): { w: number; h: number } | null {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function validateImage(buf: Buffer): { ok: true; kind: string; w?: number; h?: number } | { ok: false; reason: string } {
  if (buf.length > MAX_BYTES) return { ok: false, reason: "image too large (2MB)" };
  if (buf.length < 32) return { ok: false, reason: "not an image" };
  const kind = magic(buf);
  if (!kind) return { ok: false, reason: "unsupported image type" };
  const dim = kind === "png" ? pngSize(buf) : kind === "jpeg" ? jpegSize(buf) : null;
  if (dim && (dim.w > MAX_DIM || dim.h > MAX_DIM || dim.w < 32 || dim.h < 32)) {
    return { ok: false, reason: "image dimensions out of range" };
  }
  return { ok: true, kind, w: dim?.w, h: dim?.h };
}

export class ObjectStore {
  constructor(private root: string) {
    mkdirSync(root, { recursive: true });
  }

  async put(buf: Buffer, contentType: string): Promise<StoredMedia> {
    const v = validateImage(buf);
    if (!v.ok) throw new Error(v.reason);
    const out = await sharp(buf).rotate().resize(TARGET, TARGET, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    const type = "image/webp";
    const id = createHash("sha256").update(out).digest("hex").slice(0, 20);
    const uri = mediaPublicUri(id);
    const key = mediaObjectKey(id);
    assertMediaKeyMatchesPublicUri(key, uri);
    const path = join(this.root, `${id}.webp`);
    if (!existsSync(path)) writeFileSync(path, out);
    await this.maybeRemote(key, out, type);
    void contentType;
    return { id, uri, contentType: type, bytes: out.length };
  }

  get(name: string): { buf: Buffer; type: string } | null {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "");
    const path = join(this.root, safe);
    if (!existsSync(path)) return null;
    const type = safe.endsWith(".webp") ? "image/webp" : safe.endsWith(".png") ? "image/png" : "image/jpeg";
    return { buf: readFileSync(path), type };
  }

  private async maybeRemote(key: string, buf: Buffer, type: string) {
    const endpoint = process.env.R2_ENDPOINT ?? process.env.S3_ENDPOINT;
    const bucket = process.env.R2_BUCKET ?? process.env.S3_BUCKET;
    const prod = (process.env.REACTOR_ENV ?? "").toUpperCase() === "PROD";
    if (!endpoint || !bucket) {
      if (prod) throw new Error("R2/S3 required in prod — media fail-closed");
      return;
    }
    const keyId = process.env.R2_ACCESS_KEY ?? process.env.S3_ACCESS_KEY;
    const secret = process.env.R2_SECRET_KEY ?? process.env.S3_SECRET_KEY;
    if (!keyId || !secret) {
      if (prod) throw new Error("R2/S3 credentials missing — media fail-closed");
      return;
    }
    const put = await s3PutSigV4({
      endpoint,
      bucket,
      key,
      body: buf,
      contentType: type,
      accessKey: keyId,
      secretKey: secret,
    });
    if (put.status < 200 || put.status >= 300) {
      throw new Error(`R2/S3 SigV4 upload failed ${put.status}${prod ? " — media fail-closed" : ""}`);
    }
    void dirname;
    void randomBytes;
  }
}

export function publicMediaUrl(uri: string): string {
  const cdn = process.env.MEDIA_CDN_BASE;
  if (cdn) return `${cdn.replace(/\/$/, "")}${uri}`;
  return uri;
}
