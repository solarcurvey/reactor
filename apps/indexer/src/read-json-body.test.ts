import { readFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BodyTooLargeError,
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  declaredContentLength,
  jsonBodyLimitBytes,
  readJsonBody,
} from "./read-json-body.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function listen(): Promise<{ url: URL; close: () => Promise<void> }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readJsonBody(req, 1024);
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ ok: true, body }));
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        res.writeHead(413, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify({ error: e.message, status: 413 }));
        return;
      }
      res.writeHead(400, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : "invalid json" }));
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: new URL(`http://127.0.0.1:${port}/`),
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

type Hit = { status: number; json: Record<string, unknown>; raw: string };

function post(url: URL, opts: { body: string | Buffer; headers?: Record<string, string>; chunked?: boolean }): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...opts.headers,
    };
    if (opts.chunked) {
      headers["transfer-encoding"] = "chunked";
      delete headers["content-length"];
    } else if (!headers["content-length"]) {
      headers["content-length"] = String(Buffer.byteLength(opts.body));
    }
    const req = httpRequest(
      url,
      { method: "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(raw || "{}") as Record<string, unknown>;
          } catch {
            json = { parseError: raw };
          }
          resolve({ status: res.statusCode ?? 0, json, raw });
        });
      },
    );
    req.on("error", reject);
    if (opts.chunked && typeof opts.body === "string") {
      const step = 64;
      for (let i = 0; i < opts.body.length; i += step) {
        req.write(opts.body.slice(i, i + step));
      }
      req.end();
      return;
    }
    req.end(opts.body);
  });
}

{
  assert(DEFAULT_JSON_BODY_LIMIT_BYTES === 16 * 1024, "default 16KiB");
  const prev = process.env.JSON_BODY_LIMIT_BYTES;
  delete process.env.JSON_BODY_LIMIT_BYTES;
  assert(jsonBodyLimitBytes() === 16_384, "env default");
  process.env.JSON_BODY_LIMIT_BYTES = "4096";
  assert(jsonBodyLimitBytes() === 4096, "env override");
  process.env.JSON_BODY_LIMIT_BYTES = "nope";
  assert(jsonBodyLimitBytes() === 16_384, "bad env falls back");
  if (prev === undefined) delete process.env.JSON_BODY_LIMIT_BYTES;
  else process.env.JSON_BODY_LIMIT_BYTES = prev;
}

{
  assert(declaredContentLength({}) === null, "missing CL");
  assert(declaredContentLength({ "content-length": "12" }) === 12, "CL");
  assert(declaredContentLength({ "content-length": ["12", "12"] }) === 12, "matching CL list");
  assert(declaredContentLength({ "content-length": ["12", "99"] }) === null, "disagreeing CL");
  assert(declaredContentLength({ "content-length": "abc" }) === null, "non-numeric CL");
}

const { url, close } = await listen();

{
  const hit = await post(url, { body: JSON.stringify({ token: "0x1", side: "BUY" }) });
  assert(hit.status === 200 && (hit.json.body as { token?: string })?.token === "0x1", `small JSON ${hit.raw}`);
}

{
  const hit = await post(url, { body: "" });
  assert(hit.status === 200 && JSON.stringify(hit.json.body) === "{}", `empty ${hit.raw}`);
}

{
  const hit = await post(url, { body: "{not-json" });
  assert(hit.status === 400, `invalid JSON ${hit.status} ${hit.raw}`);
}

{
  const hit = await post(url, { body: "[]" });
  assert(hit.status === 400, `array rejected ${hit.raw}`);
}

{
  const over = `{"pad":"${"x".repeat(2000)}"}`;
  assert(Buffer.byteLength(over) > 1024, "fixture over 1KiB");
  const hit = await post(url, { body: over });
  assert(hit.status === 413, `Content-Length oversize ${hit.status} ${hit.raw}`);
  assert(String(hit.json.error).includes("1024 byte JSON limit"), `error copy ${hit.raw}`);
}

{
  const over = `{"pad":"${"x".repeat(2000)}"}`;
  const hit = await post(url, { body: over, chunked: true });
  assert(hit.status === 413, `chunked oversize ${hit.status} ${hit.raw}`);
  assert(String(hit.json.error).includes("byte JSON limit"), `chunked error ${hit.raw}`);
}

{
  const ok = `{"pad":"${"x".repeat(20)}"}`;
  const hit = await post(url, { body: ok, chunked: true });
  assert(hit.status === 200 && (hit.json.body as { pad?: string })?.pad?.length === 20, `chunked under limit ${hit.raw}`);
}

{
  // Declared Content-Length over the cap is rejected before the body is consumed.
  const hit = await post(url, {
    body: JSON.stringify({ tiny: true }),
    headers: { "content-length": "999999" },
  });
  assert(hit.status === 413, `declared CL lie-high ${hit.status} ${hit.raw}`);
}

{
  // Many small chunks, no Content-Length, total over the cap (chunked Transfer-Encoding).
  const pad = "y".repeat(80);
  const parts = Array.from({ length: 20 }, () => `"${pad}"`);
  const over = `{"items":[${parts.join(",")}]}`;
  assert(Buffer.byteLength(over) > 1024, `chunked many-parts ${Buffer.byteLength(over)}`);
  const hit = await post(url, { body: over, chunked: true });
  assert(hit.status === 413, `chunked many-parts oversize ${hit.status} ${hit.raw}`);
}

{
  // Client keeps writing after the server has already decided 413.
  const hit = await new Promise<Hit>((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(raw || "{}") as Record<string, unknown>, raw });
        });
      },
    );
    req.on("error", (err) => {
      // Destroyed socket while still writing is an acceptable 413 path.
      if ((err as NodeJS.ErrnoException).code === "ECONNRESET" || (err as NodeJS.ErrnoException).code === "EPIPE") {
        resolve({ status: 413, json: { error: "connection reset after overflow" }, raw: String(err) });
        return;
      }
      reject(err);
    });
    req.write(`{"pad":"`);
    const timer = setInterval(() => {
      try {
        req.write("z".repeat(256));
      } catch {
        clearInterval(timer);
      }
    }, 5);
    setTimeout(() => {
      clearInterval(timer);
      try {
        req.write(`"}`);
        req.end();
      } catch {
        /* destroyed */
      }
    }, 80);
  });
  assert(hit.status === 413, `slow chunked oversize ${hit.status} ${hit.raw}`);
}

await close();

{
  const here = dirname(fileURLToPath(import.meta.url));
  const indexer = readFileSync(join(here, "index.ts"), "utf8");
  assert(!indexer.includes("function readBody("), "unbounded readBody must stay deleted");
  assert(indexer.includes("readPublicJson"), "public JSON helper wired");
  for (const path of ["/quote", "/launch/admit", "/launch/authorize"]) {
    const idx = indexer.indexOf(`url.pathname === "${path}"`);
    assert(idx >= 0, `public JSON POST ${path}`);
    assert(indexer.slice(idx, idx + 800).includes("readPublicJson"), `${path} uses bounded reader`);
  }
  const signer = readFileSync(join(here, "pricing-signer.ts"), "utf8");
  assert(signer.includes("readJsonBody"), "isolated signer uses bounded reader");
  assert(!signer.includes("for await (const c of req) chunks.push"), "signer no longer buffers unbounded");
}

console.log("read-json-body tests ok");
