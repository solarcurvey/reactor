import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import {
  createSanctionsOps,
  extractWallet,
  handleSanctionsOpsRequest,
  isProtectedWritePath,
  protectedAction,
  sanctionsHealthBody,
} from "./sanctions-ops.ts";
import { fixtureRefreshPayload } from "../../../packages/reactor/src/sanctions-ops.ts";
import { OPERATOR_POLICY_ID } from "../../../packages/reactor/src/sanctions-policy.ts";
import { recentAlerts } from "./alerts.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const WALLET = "0x2222222222222222222222222222222222222222";
const t0 = Date.parse("2026-09-12T00:00:00.000Z");

{
  assert(isProtectedWritePath("POST", "/quote"), "quote is protected");
  assert(isProtectedWritePath("POST", "/launch/authorize"), "authorize is protected");
  assert(!isProtectedWritePath("GET", "/markets"), "public GET is not gated");
  assert(!isProtectedWritePath("GET", "/health"), "liveness is not gated");
  assert(protectedAction("/launch/admit") === "launch.admit", "admit action");
  assert(extractWallet({ headers: {}, body: { wallet: WALLET } }) === WALLET, "wallet from body");
  assert(extractWallet({ headers: { "x-reactor-wallet": WALLET }, body: {} }) === WALLET, "wallet from header");
}

{
  const dir = mkdtempSync(join(tmpdir(), "idx-sanctions-http-"));
  const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
  let now = t0;
  const ops = await createSanctionsOps(store, { REACTOR_ENV: "LOCAL" }, {
    dataDir: join(dir, "sanctions"),
    now: () => now,
    fetchOfficialList: async () => fixtureRefreshPayload(new Date(now).toISOString()),
  });
  const first = await ops.refresh();
  assert(first.ok, "indexer refresh ok");

  const health = handleSanctionsOpsRequest(ops, { method: "GET", pathname: "/sanctions/health" });
  assert(health?.status === 200, "health route");
  const body = health!.body;
  assert(body.dataset && typeof body.dataset === "object", "health has dataset");
  const dataset = body.dataset as { versionId: string; contentHash: string };
  assert(first.ok && dataset.versionId === first.version.id, "dashboard dataset version");
  assert(dataset.contentHash === first.version.contentHash, "dashboard content hash");
  assert(body.policy && (body.policy as { operatorPolicyVersion: string }).operatorPolicyVersion === OPERATOR_POLICY_ID, "dashboard operator policy");
  assert((body.policy as { geoPolicyVersion: string }).geoPolicyVersion, "dashboard geo policy");

  const packed = sanctionsHealthBody(ops);
  assert(packed.operatorPolicyVersion === OPERATOR_POLICY_ID, "packed operator version");
  assert(packed.dataset.versionId === dataset.versionId, "packed matches route");

  const unauth = handleSanctionsOpsRequest(ops, { method: "POST", pathname: "/ops/sanctions/refresh" });
  assert(unauth?.status === 401, "refresh requires ops token");

  const denied = ops.gateProtectedWrite({ action: "quote", wallet: WALLET });
  assert(denied.ok, "fresh allow");

  ops.setInject("refresh_fail");
  let lastFail: Awaited<ReturnType<typeof ops.refresh>> | undefined;
  for (let i = 0; i < 3; i++) lastFail = await ops.refresh();
  assert(lastFail && !lastFail.ok, "failure inject");
  assert(first.ok && lastFail.preservedVersion?.id === first.version.id, "inject preserves LKG");
  const alerts = await recentAlerts(store, 20);
  assert(
    alerts.some((a) => String(a.code).startsWith("sanctions_")),
    `alerts persisted: ${alerts.map((a) => a.code).join(",")}`,
  );

  now = t0 + 8 * 24 * 60 * 60 * 1000;
  ops.setInject("none");
  const stale = ops.gateProtectedWrite({ action: "launch.authorize", wallet: WALLET });
  assert(!stale.ok && stale.body?.reason === "UNAVAILABLE_DATASET_STALE", "stale write denied on indexer gate");

  const complaint = handleSanctionsOpsRequest(ops, {
    method: "POST",
    pathname: "/ops/sanctions/review",
    opsAuthorized: true,
    body: { kind: "user_complaint", wallet: WALLET, reason: "please allow me" },
  });
  assert(complaint?.status === 403, "complaint rejected");
  assert((complaint?.body as { error?: string }).error === "NO_AUTOMATED_OVERRIDE", "no auto override");

  await store.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log("indexer sanctions-ops tests ok");
