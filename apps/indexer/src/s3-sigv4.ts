import { createHash, createHmac } from "node:crypto";

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function s3PutSigV4(opts: {
  endpoint: string;
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}): Promise<{ status: number; url: string }> {
  const region = opts.region ?? process.env.S3_REGION ?? process.env.R2_REGION ?? "auto";
  const service = "s3";
  const url = new URL(`${opts.endpoint.replace(/\/$/, "")}/${opts.bucket}/${opts.key}`);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(opts.body);
  const canonicalUri = url.pathname;
  const canonicalHeaders = `content-type:${opts.contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonical = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const kDate = hmac(`AWS4${opts.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      "content-type": opts.contentType,
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization,
    },
    body: new Uint8Array(opts.body),
    signal: AbortSignal.timeout(8_000),
  });
  return { status: res.status, url: url.toString() };
}
