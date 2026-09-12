import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BodyTooLargeError, JSON_BODY_LIMIT_BYTES, readLimitedText } from "./limited-json.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  assert(JSON_BODY_LIMIT_BYTES === 16 * 1024, "web BFF matches indexer 16KiB");
}

{
  const req = new Request("http://127.0.0.1/api/launch-pricing", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "20" },
    body: JSON.stringify({ ticker: "CAT" }),
  });
  const text = await readLimitedText(req);
  assert(text.includes("CAT"), `small ${text}`);
}

{
  const req = new Request("http://127.0.0.1/api/launch-pricing", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "999999" },
    body: "{}",
  });
  let threw = false;
  try {
    await readLimitedText(req);
  } catch (e) {
    threw = e instanceof BodyTooLargeError && e.status === 413;
  }
  assert(threw, "declared Content-Length over the cap");
}

{
  const encoder = new TextEncoder();
  const pad = "x".repeat(2000);
  const body = JSON.stringify({ pad });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = encoder.encode(body);
      const step = 64;
      for (let i = 0; i < bytes.byteLength; i += step) {
        controller.enqueue(bytes.subarray(i, i + step));
      }
      controller.close();
    },
  });
  const req = new Request("http://127.0.0.1/api/launch-pricing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    // @ts-expect-error undici duplex for streaming Request
    duplex: "half",
  });
  let threw = false;
  try {
    await readLimitedText(req, 1024);
  } catch (e) {
    threw = e instanceof BodyTooLargeError;
  }
  assert(threw, "chunked/streamed oversize without Content-Length");
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const route = readFileSync(join(here, "../app/api/launch-pricing/route.ts"), "utf8");
  assert(route.includes("readLimitedText"), "BFF uses bounded reader");
  assert(!route.includes("await req.text()"), "BFF no longer buffers unbounded text");
}

console.log("limited-json tests ok");
