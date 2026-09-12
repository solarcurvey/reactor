/**
 * Isolated launch-pricing signer process. Never import this from Next.
 * Public callers without an ALLOW AdmissionReceipt are rejected.
 */
import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { SECURITY_HEADERS, logLine, requestId, RateLimit } from "./obs.ts";
import { resolveSignerKey, signAuthorized, type SignRequest } from "./launch-signer.ts";
import { openStore } from "./db.ts";
import { assertProductionHardGates } from "./prod-gates.ts";

const PORT = Number(process.env.PRICING_SIGNER_PORT ?? 43149);
const LOCAL = (process.env.REACTOR_ENV ?? "").toUpperCase() === "LOCAL";
const limit = new RateLimit(60_000, Number(process.env.PRICING_RPM ?? 30));

const storePromise = openStore().catch(() => undefined);

const server = createServer(async (req, res) => {
  const rid = requestId({ headers: req.headers as Record<string, string | string[] | undefined> });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Access-Control-Allow-Origin", "null");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("x-request-id", rid);
  if (req.method === "GET" && req.url === "/health") {
    try {
      const acct = privateKeyToAccount(resolveSignerKey());
      res.end(JSON.stringify({ ok: true, signer: acct.address, local: LOCAL, request_id: rid, public: false }));
    } catch (e) {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, error: String(e), request_id: rid }));
    }
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (!limit.allow(String(req.socket.remoteAddress))) {
    res.statusCode = 429;
    res.end(JSON.stringify({ error: "rate limited", request_id: rid }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as SignRequest;
    const store = await storePromise;
    const out = await signAuthorized(store, body, {
      receipt: body.receipt ?? String(req.headers["x-admission-receipt"] ?? ""),
      internalToken: String(req.headers["x-internal-signer-token"] ?? ""),
      remoteAddress: String(req.socket.remoteAddress ?? ""),
    });
    res.end(JSON.stringify({ ...out, request_id: rid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sign failed";
    const denied = msg.includes("ADMISSION") || msg.includes("SIGNER_");
    res.statusCode = denied ? 403 : msg.includes("UNAVAILABLE") || msg.includes("cannot price") ? 503 : 500;
    res.end(JSON.stringify({ error: msg, needsAuth: true, request_id: rid }));
  }
});

try {
  assertProductionHardGates();
  resolveSignerKey();
} catch (e) {
  console.error("pricing signer refuse start", e);
  process.exit(1);
}

server.listen(PORT, "127.0.0.1", () => logLine({ msg: "pricing-signer", port: PORT, local: LOCAL, bind: "127.0.0.1" }));
