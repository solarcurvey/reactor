import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import sharp from "sharp";
import {
  ObjectStore,
  type StoredMedia,
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

type StoredObject = { body: Buffer; contentType: string };

type MockS3 = {
  endpoint: string;
  bucket: string;
  objects: Map<string, StoredObject>;
  puts: CapturedPut[];
};

function objectKeyFromUrl(url: string, bucket: string): string | null {
  const prefix = `/${bucket}/`;
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length));
}

async function withMockS3<T>(
  opts: { bucket: string; putStatus?: number },
  fn: (mock: MockS3) => Promise<T>,
): Promise<T> {
  const objects = new Map<string, StoredObject>();
  const puts: CapturedPut[] = [];
  const putStatus = opts.putStatus ?? 200;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = req.url ?? "";
      const method = req.method ?? "";
      const contentType = String(req.headers["content-type"] ?? "");
      const key = objectKeyFromUrl(url, opts.bucket);

      if (method === "PUT") {
        puts.push({
          method,
          url,
          contentType,
          authorization: String(req.headers.authorization ?? ""),
          body,
        });
        if (putStatus >= 200 && putStatus < 300 && key) {
          objects.set(key, { body, contentType });
        }
        res.statusCode = putStatus;
        res.end();
        return;
      }
      if (method === "GET") {
        const obj = key ? objects.get(key) : undefined;
        if (!obj) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", obj.contentType);
        res.end(obj.body);
        return;
      }
      res.statusCode = 405;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn({ endpoint: `http://127.0.0.1:${port}`, bucket: opts.bucket, objects, puts });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function remoteGet(endpoint: string, bucket: string, key: string): Promise<{
  status: number;
  contentType: string;
  body: Buffer;
}> {
  const res = await fetch(`${endpoint}/${bucket}/${key}`);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body: Buffer.from(await res.arrayBuffer()),
  };
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

  await withMockS3({ bucket }, async (mock) => {
    process.env.R2_ENDPOINT = mock.endpoint;
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

    assert(mock.puts.length === 1, `expected 1 SigV4 PUT, got ${mock.puts.length}`);
    const put = mock.puts[0]!;
    assert(put.method === "PUT", `method ${put.method}`);
    assert(put.url === `/${bucket}/${key}`, `uploaded path ${put.url} != /${bucket}/${key}`);
    assert(!put.url.endsWith(`/${stored.id}`), "upload path must not be bare /<bucket>/<id>");
    assert(put.url.endsWith(".webp"), "upload path includes .webp");
    assert(put.url.includes("/m/"), "upload path includes m/ prefix");
    assert(put.contentType === "image/webp", `content-type ${put.contentType}`);
    assert(put.authorization.startsWith("AWS4-HMAC-SHA256 "), "SigV4 Authorization present");
    assert(put.body.length > 0, "uploaded body");
    assert(put.body.slice(0, 4).toString() === "RIFF", "uploaded WebP");
    assert(mock.objects.has(key), "mock stored object under m/<id>.webp");
    assert(!mock.objects.has(stored.id), "mock did not store bare <id>");

    const remote = await remoteGet(mock.endpoint, bucket, key);
    assert(remote.status === 200, `GET ${key} status ${remote.status}`);
    assert(remote.contentType === "image/webp", `GET content-type ${remote.contentType}`);
    assert(remote.body.equals(put.body), "GET bytes match PUT body");
    assert(remote.body.equals(mock.objects.get(key)!.body), "GET bytes match stored object");

    const publicPathGet = await remoteGet(mock.endpoint, bucket, stored.uri.slice(1));
    assert(publicPathGet.status === 200, "GET via public-uri path (no leading slash) hits the object");
    assert(publicPathGet.body.equals(remote.body), "public-uri path GET equals object-key GET");
    assert(publicPathGet.contentType === stored.contentType, "GET content-type matches StoredMedia");

    const stale = await remoteGet(mock.endpoint, bucket, stored.id);
    assert(stale.status === 404, "GET bare <id> (old key) is 404");

    const local = store.get(`${stored.id}.webp`);
    assert(local && local.type === "image/webp", "local disk still stores <id>.webp");
    assert(local!.buf.equals(remote.body), "local bytes match remote GET");
  });
  console.log("R2 mock put() + GET m/<id>.webp ok");

  await withMockS3({ bucket }, async (mock) => {
    delete process.env.R2_ENDPOINT;
    delete process.env.R2_BUCKET;
    delete process.env.R2_ACCESS_KEY;
    delete process.env.R2_SECRET_KEY;
    process.env.S3_ENDPOINT = mock.endpoint;
    process.env.S3_BUCKET = bucket;
    process.env.S3_ACCESS_KEY = "s3-access";
    process.env.S3_SECRET_KEY = "s3-secret";
    process.env.MEDIA_CDN_BASE = cdn;
    process.env.REACTOR_ENV = "LOCAL";

    const store = new ObjectStore(join(dir, "s3"));
    const stored = await store.put(png, "image/png");
    const key = mediaObjectKey(stored.id);
    assert(mock.puts.length === 1, `S3 expected 1 PUT, got ${mock.puts.length}`);
    assert(mock.puts[0]!.url === `/${bucket}/${key}`, `S3 uploaded path ${mock.puts[0]!.url}`);
    assert(publicMediaUrl(stored.uri).endsWith(`/${key}`), "public URL path equals object key");

    const remote = await remoteGet(mock.endpoint, bucket, key);
    assert(remote.status === 200, `S3 GET ${key} status ${remote.status}`);
    assert(remote.contentType === "image/webp", `S3 GET content-type ${remote.contentType}`);
    assert(remote.body.equals(mock.puts[0]!.body), "S3 GET bytes match PUT");
    assert((await remoteGet(mock.endpoint, bucket, stored.id)).status === 404, "S3 GET bare id 404");
  });
  console.log("S3 mock put() + GET m/<id>.webp ok");

  await withMockS3({ bucket, putStatus: 503 }, async (mock) => {
    process.env.R2_ENDPOINT = mock.endpoint;
    process.env.R2_BUCKET = bucket;
    process.env.R2_ACCESS_KEY = "test-access";
    process.env.R2_SECRET_KEY = "test-secret";
    process.env.MEDIA_CDN_BASE = cdn;
    process.env.REACTOR_ENV = "PROD";
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;

    const store = new ObjectStore(join(dir, "prod-fail"));
    let stored: StoredMedia | undefined;
    let err: unknown;
    try {
      stored = await store.put(png, "image/png");
    } catch (e) {
      err = e;
    }
    assert(stored === undefined, "PROD upload failure returns no StoredMedia");
    assert(err instanceof Error, "PROD upload failure throws");
    assert(err.message.includes("SigV4 upload failed 503"), `PROD error ${err.message}`);
    assert(err.message.includes("media fail-closed"), "PROD upload failure is fail-closed");
    assert(mock.objects.size === 0, "failed PUT did not persist an object");
  });
  console.log("PROD remote upload failure rejects with no StoredMedia ok");

  {
    delete process.env.R2_ENDPOINT;
    delete process.env.R2_BUCKET;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    process.env.REACTOR_ENV = "LOCAL";
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
