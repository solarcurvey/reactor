/**
 * Isolated launch-pricing signer process. Never import this from Next.
 * Public callers without an ALLOW AdmissionReceipt are rejected.
 */
import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { SECURITY_HEADERS, logLine, requestId, RateLimit } from "./obs.ts";
import { abortIncoming, BodyTooLargeError, readJsonBody } from "./read-json-body.ts";
import {
  openSignerStore,
  resolveSignerKey,
  signAuthorized,
  signerHttpStatus,
  type SignRequest,
} from "./launch-signer.ts";
import type { Store } from "./db.ts";
import { assertProductionHardGates } from "./prod-gates.ts";
import { bindRecoveredIdentity, gateProtectedWrite, tryBindOfficialPolicyPlugins } from "./operator-policy.ts";
import { applySanctionsOpsGate, createSanctionsOps } from "./sanctions-ops.ts";
import type { SanctionsOps } from "../../../packages/reactor/src/sanctions-ops.ts";

const PORT = Number(process.env.PRICING_SIGNER_PORT ?? 43149);
const LOCAL = (process.env.REACTOR_ENV ?? "").toUpperCase() === "LOCAL";
const limit = new RateLimit(60_000, Number(process.env.PRICING_RPM ?? 30));

let storePromise: Promise<Store> | undefined;
let sanctionsOpsPromise: Promise<SanctionsOps> | undefined;

function sanctionsOps(): Promise<SanctionsOps> {
  if (!sanctionsOpsPromise) {
    sanctionsOpsPromise = createSanctionsOps(null);
  }
  return sanctionsOpsPromise;
}

function durableStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = openSignerStore().catch((e) => {
      storePromise = undefined;
      throw e;
    });
  }
  return storePromise;
}

const server = createServer(async (req, res) => {
  const rid = requestId({ headers: req.headers as Record<string, string | string[] | undefined> });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Access-Control-Allow-Origin", "null");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("x-request-id", rid);
  if (req.method === "GET" && req.url === "/health") {
    try {
      await durableStore();
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
  try {
    const body = (await readJsonBody(req)) as SignRequest;
    const gate = await gateProtectedWrite({
      headers: req.headers,
      body: body as unknown as Record<string, unknown>,
      surface: "launch.signer",
    });
    if (!gate.ok) {
      res.statusCode = gate.status;
      res.end(JSON.stringify({ ...gate.body, request_id: rid }));
      return;
    }
    bindRecoveredIdentity(body as unknown as Record<string, unknown>, gate.wallet);
    const freshness = await applySanctionsOpsGate({
      ops: await sanctionsOps(),
      action: "launch.sign",
      headers: req.headers,
      body: body as unknown as Record<string, unknown>,
      requestId: rid,
    });
    if (!freshness.ok) {
      res.statusCode = freshness.status;
      res.end(JSON.stringify({ ...freshness.body, request_id: rid }));
      return;
    }
    const store = await durableStore();
    const out = await signAuthorized(store, body, {
      receipt: body.receipt ?? String(req.headers["x-admission-receipt"] ?? ""),
      internalToken: String(req.headers["x-internal-signer-token"] ?? ""),
      remoteAddress: String(req.socket.remoteAddress ?? ""),
    });
    res.end(JSON.stringify({ ...out, request_id: rid }));
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      res.statusCode = 413;
      res.setHeader("Connection", "close");
      res.end(JSON.stringify({ error: e.message, request_id: rid }));
      abortIncoming(req);
      return;
    }
    const msg = e instanceof Error ? e.message : "sign failed";
    res.statusCode = e instanceof SyntaxError ? 400 : signerHttpStatus(e);
    res.end(JSON.stringify({ error: msg, needsAuth: true, request_id: rid }));
  }
});

try {
  assertProductionHardGates();
  resolveSignerKey();
  await tryBindOfficialPolicyPlugins();
} catch (e) {
  console.error("pricing signer refuse start", e);
  process.exit(1);
}

server.listen(PORT, "127.0.0.1", () => logLine({ msg: "pricing-signer", port: PORT, local: LOCAL, bind: "127.0.0.1" }));
