import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { AddressInfo } from "node:net";
import { openStore, type Store } from "./db.ts";
import {
  attachSignedMaintenance,
  nextSignedMaintenance,
  nextUnsignedMaintenance,
  recordManagedRelayResult,
  type ManagedRelayResult,
} from "./maintenance-queue.ts";
import { maintenanceEnvelopeToJson } from "../../../packages/reactor/src/maintenance-envelope.ts";

const MAX_BODY = 128 * 1024;
type QueueRole = "authorizer" | "relay-A" | "relay-B";

type QueueTokens = Record<QueueRole, string>;

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function equalSecret(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function roleFor(req: IncomingMessage, tokens: QueueTokens): QueueRole | undefined {
  const raw = req.headers.authorization ?? "";
  for (const role of ["authorizer", "relay-A", "relay-B"] as const) {
    if (equalSecret(raw, `Bearer ${tokens[role]}`)) return role;
  }
  return undefined;
}

function assertTokenSet(tokens: QueueTokens): void {
  const values = Object.values(tokens);
  if (values.some((x) => x.length < 24)) throw new Error("maintenance API role tokens must be strong (>=24 chars)");
  if (new Set(values).size !== values.length) throw new Error("maintenance API authorizer/relay tokens must be distinct");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    n += b.length;
    if (n > MAX_BODY) throw new Error("body too large");
    chunks.push(b);
  }
  if (n === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function handleMaintenanceQueueRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  tokens: QueueTokens,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, service: "reactor-maintenance-queue" });
    return;
  }
  const role = roleFor(req, tokens);
  if (!role) {
    json(res, 401, { error: "unauthorized" });
    return;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    if (req.method === "GET" && url.pathname === "/ops/maintenance/unsigned") {
      if (role !== "authorizer") {
        json(res, 403, { error: "authorizer role required" });
        return;
      }
      const env = await nextUnsignedMaintenance(store, nowSec);
      if (!env) {
        res.writeHead(204, { "cache-control": "no-store" });
        res.end();
        return;
      }
      json(res, 200, { item: maintenanceEnvelopeToJson(env) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/ops/maintenance/signed") {
      if (role !== "authorizer") {
        json(res, 403, { error: "authorizer role required" });
        return;
      }
      const env = await attachSignedMaintenance(store, await readJson(req));
      json(res, 200, { jobId: env.job.jobId, stored: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/ops/maintenance/signed") {
      if (role !== "relay-A" && role !== "relay-B") {
        json(res, 403, { error: "relay role required" });
        return;
      }
      const env = await nextSignedMaintenance(store, nowSec);
      if (!env) {
        res.writeHead(204, { "cache-control": "no-store" });
        res.end();
        return;
      }
      json(res, 200, { item: maintenanceEnvelopeToJson(env) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/ops/maintenance/result") {
      if (role !== "relay-A" && role !== "relay-B") {
        json(res, 403, { error: "relay role required" });
        return;
      }
      const body = await readJson(req) as ManagedRelayResult;
      const expectedRelay = role === "relay-A" ? "A" : "B";
      if (body.relay !== expectedRelay) {
        json(res, 403, { error: "relay identity mismatch" });
        return;
      }
      await recordManagedRelayResult(store, body);
      json(res, 200, { stored: true, jobId: body.jobId, status: body.status });
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("body too large") ? 413 : msg.includes("unknown job") ? 404 : 400;
    json(res, code, { error: msg });
  }
}

export async function startMaintenanceQueueServer(opts?: {
  store?: Store;
  tokens?: QueueTokens;
  port?: number;
  host?: string;
}) {
  const store = opts?.store ?? await openStore();
  const tokens = opts?.tokens ?? {
    authorizer: process.env.MAINTENANCE_AUTHORIZER_TOKEN ?? "",
    "relay-A": process.env.MAINTENANCE_RELAY_A_TOKEN ?? "",
    "relay-B": process.env.MAINTENANCE_RELAY_B_TOKEN ?? "",
  };
  assertTokenSet(tokens);
  const requestedPort = opts?.port ?? Number(process.env.MAINTENANCE_API_PORT ?? 43150);
  const host = opts?.host ?? process.env.MAINTENANCE_API_HOST ?? "127.0.0.1";
  const server = createServer((req, res) => {
    handleMaintenanceQueueRequest(req, res, store, tokens).catch((e) => {
      console.error("maintenance queue request failed", e);
      if (!res.headersSent) json(res, 500, { error: "internal" });
      else res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(requestedPort, host, resolve));
  const address = server.address() as AddressInfo;
  return { server, store, host, port: address.port };
}

if (process.env.MAINTENANCE_QUEUE_TEST !== "1" && process.argv[1]?.endsWith("maintenance-queue-api.ts")) {
  startMaintenanceQueueServer()
    .then(({ host, port }) => console.log(`maintenance queue listening on ${host}:${port}`))
    .catch((e) => {
      console.error("maintenance queue failed to start", e);
      process.exit(1);
    });
}
