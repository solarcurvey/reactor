import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import sharp from "sharp";
import {
  ObjectStore,
  assertMediaKeyMatchesPublicUri,
  mediaObjectKey,
  mediaPublicUri,
  publicMediaUrl,
} from "./media.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sampleId = "a".repeat(20);
assert(mediaPublicUri(sampleId) === `/m/${sampleId}.webp`, "public uri is /m/<id>.webp");
assert(mediaObjectKey(sampleId) === `m/${sampleId}.webp`, "object key is m/<id>.webp");
assert(mediaObjectKey(sampleId) !== sampleId, "object key is not the bare id");
assertMediaKeyMatchesPublicUri(mediaObjectKey(sampleId), mediaPublicUri(sampleId));
let threw = false;
try {
  assertMediaKeyMatchesPublicUri(sampleId, mediaPublicUri(sampleId));
} catch {
  threw = true;
}
assert(threw, "bare id must not match public uri");
console.log("media key/uri helpers ok");

type CapturedPut = {
  method: string;
  url: string;
  contentType: string;
  authorization: string;
  body: Buffer;
};

async function withMockS3<T>(
  handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void,
  fn: (endpoint: string, puts: CapturedPut[]) => Promise<T>,
): Promise<T> {
  const puts: CapturedPut[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      puts.push({
        method: req.method ?? "",
        url: req.url ?? "",
        contentType: String(req.headers["content-type"] ?? ""),
        authorization: String(req.headers.authorization ?? ""),
        body,
      });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`, puts);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function fixturePng(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 30, g: 90, b: 180 } },
  })
    .png()
    .toBuffer();
}

const ENV_KEYS = [
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_ACCESS_KEY",
  "R2_SECRET_KEY",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "MEDIA_CDN_BASE",
  "REACTOR_ENV",
] as const;

function snapshotEnv(): Record<(typeof ENV_KEYS)[number], string | undefined> {
  const out = {} as Record<(typeof ENV_KEYS)[number], string | undefined>;
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(prev: Record<(typeof ENV_KEYS)[number], string | undefined>) {
  for (const k of ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
}

const prev = snapshotEnv();
const dir = mkdtempSync(join(tmpdir(), "reactor-media-"));
try {
  const png = await fixturePng();
  const bucket = "reactor-media";
  const cdn = "https://cdn.test";

  await withMockS3(
    (_req, res) => {
      res.statusCode = 200;
      res.end();
    },
    async (endpoint, puts) => {
      process.env.R2_ENDPOINT = endpoint;
      process.env.R2_BUCKET = bucket;
      process.env.R2_ACCESS_KEY = "test-access";
      process.env.R2_SECRET_KEY = "test-secret";
      process.env.MEDIA_CDN_BASE = cdn;
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_BUCKET;
      delete process.env.S3_ACCESS_KEY;
      delete process.env.S3_SECRET_KEY;
      process.env.REACTOR_ENV = "LOCAL";

      const store = new ObjectStore(join(dir, "r2"));
      const stored = await store.put(png, "image/png");
      const key = mediaObjectKey(stored.id);
      const uri = mediaPublicUri(stored.id);

      assert(stored.uri === uri, `put() uri ${stored.uri} != ${uri}`);
      assert(stored.uri === `/m/${stored.id}.webp`, "put() returns /m/<id>.webp");
      assert(key === `m/${stored.id}.webp`, "remote key is m/<id>.webp");
      assert(key !== stored.id, "remote key is not the bare id");
      assertMediaKeyMatchesPublicUri(key, stored.uri);
      assert(publicMediaUrl(stored.uri) === `${cdn}${stored.uri}`, "CDN URL is MEDIA_CDN_BASE + uri");
      assert(publicMediaUrl(stored.uri) === `${cdn}/m/${stored.id}.webp`, "CDN URL path matches public uri");

      assert(puts.length === 1, `expected 1 SigV4 PUT, got ${puts.length}`);
      const put = puts[0]!;
      assert(put.method === "PUT", `method ${put.method}`);
      assert(put.url === `/${bucket}/${key}`, `uploaded path ${put.url} != /${bucket}/${key}`);
      assert(!put.url.endsWith(`/${stored.id}`), "upload path must not be bare /<bucket>/<id>");
      assert(put.url.endsWith(".webp"), "upload path includes .webp");
      assert(put.url.includes("/m/"), "upload path includes m/ prefix");
      assert(put.contentType === "image/webp", `content-type ${put.contentType}`);
      assert(put.authorization.startsWith("AWS4-HMAC-SHA256 "), "SigV4 Authorization present");
      assert(put.body.length > 0, "uploaded body");
      assert(put.body.slice(0, 4).toString() === "RIFF", "uploaded WebP");

      const local = store.get(`${stored.id}.webp`);
      assert(local && local.type === "image/webp", "local disk still stores <id>.webp");
      assert(local!.buf.equals(put.body), "local bytes match remote body");
    },
  );
  console.log("R2 mock put() key matches /m/<id>.webp ok");

  await withMockS3(
    (_req, res) => {
      res.statusCode = 200;
      res.end();
    },
    async (endpoint, puts) => {
      delete process.env.R2_ENDPOINT;
      delete process.env.R2_BUCKET;
      delete process.env.R2_ACCESS_KEY;
      delete process.env.R2_SECRET_KEY;
      process.env.S3_ENDPOINT = endpoint;
      process.env.S3_BUCKET = bucket;
      process.env.S3_ACCESS_KEY = "s3-access";
      process.env.S3_SECRET_KEY = "s3-secret";
      process.env.MEDIA_CDN_BASE = cdn;
      process.env.REACTOR_ENV = "LOCAL";

      const store = new ObjectStore(join(dir, "s3"));
      const stored = await store.put(png, "image/png");
      const key = mediaObjectKey(stored.id);
      assert(puts.length === 1, `S3 expected 1 PUT, got ${puts.length}`);
      assert(puts[0]!.url === `/${bucket}/${key}`, `S3 uploaded path ${puts[0]!.url}`);
      assert(publicMediaUrl(stored.uri).endsWith(`/${key}`), "public URL path equals object key");
    },
  );
  console.log("S3 mock put() key matches public URL ok");

  {
    delete process.env.R2_ENDPOINT;
    delete process.env.R2_BUCKET;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    const store = new ObjectStore(join(dir, "local"));
    const stored = await store.put(png, "image/png");
    assert(stored.uri === `/m/${stored.id}.webp`, "local-only uri still /m/<id>.webp");
    assert(store.get(`${stored.id}.webp`), "local-only disk get");
  }
  console.log("local-only put() without remote ok");
} finally {
  restoreEnv(prev);
  rmSync(dir, { recursive: true, force: true });
}

console.log("media R2/S3 mock integration tests ok");
