/**
 * LOCAL #62 write-gate fixture for Playwright / bind tests.
 * Official #68 path: GET /operator-policy/challenge. Coordinated #65 UX read:
 * GET /operator-policy/status (same evaluateOperatorPolicy as write gates).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  evaluateOperatorPolicyStatus,
  gateProtectedWrite,
  incomingHeaders,
  issueOperatorWalletChallenge,
  minimizedStatusBody,
  resetOperatorPolicyBindState,
  setFixtureBlockedWallets,
} from "./operator-policy-bind.ts";

function json(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,x-reactor-wallet-proof,x-reactor-geo-fixture",
  );
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export function createOperatorPolicyFixtureServer(opts?: {
  port?: number;
  env?: NodeJS.ProcessEnv;
  blocked?: string[];
}) {
  resetOperatorPolicyBindState();
  if (opts?.blocked) setFixtureBlockedWallets(opts.blocked);
  const env = opts?.env ?? process.env;

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === "OPTIONS") {
        json(res, 204, {});
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/operator-policy/challenge") {
        const issued = issueOperatorWalletChallenge(env);
        if ("error" in issued) {
          json(res, 503, issued);
          return;
        }
        json(res, 200, issued);
        return;
      }
      if (url.pathname === "/operator-policy/status") {
        const decision = await evaluateOperatorPolicyStatus({
          headers: incomingHeaders(req),
          env,
          requireWallet: false,
        });
        json(res, decision.httpStatus, minimizedStatusBody(decision));
        return;
      }
      if (
        (url.pathname === "/launch/authorize" || url.pathname === "/launch/admit" || url.pathname === "/quote") &&
        req.method === "POST"
      ) {
        const body = await readBody(req);
        const gated = await gateProtectedWrite({
          headers: incomingHeaders(req),
          body,
          env,
          surface: `POST ${url.pathname}`,
        });
        if (!gated.ok) {
          json(res, gated.status, { ...gated.body, ranDownstream: false });
          return;
        }
        json(res, 200, { ok: true, ranDownstream: true, wallet: gated.wallet, ignored: gated.ignored });
        return;
      }
      json(res, 404, { error: "not a fixture route" });
    })().catch((e) => {
      json(res, 500, { error: e instanceof Error ? e.message : "fixture failed" });
    });
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve, reject) => {
    server.listen(opts?.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

const run = process.argv[1]?.includes("operator-policy-fixture-http");
if (run) {
  const port = Number(process.env.OPERATOR_POLICY_FIXTURE_PORT ?? 43188);
  const blocked = (process.env.OPERATOR_POLICY_BLOCKED_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const started = await createOperatorPolicyFixtureServer({ port, blocked });
  console.log(`operator-policy-fixture listening ${started.url}`);
}
