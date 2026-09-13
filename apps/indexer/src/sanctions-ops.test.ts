import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  allowFixtureSanctionsRefresh,
  applySanctionsOpsGate,
  bindOfficialRefresh,
  createSanctionsOps,
  extractWallet,
  handleSanctionsOpsRequest,
  isProtectedWritePath,
  protectedAction,
  recoverOfficialSubject,
  sanctionsHealthBody,
  walletProofChainId,
  walletProofSecret,
} from "./sanctions-ops.ts";
import { adaptOfficialRefreshPayload, fixtureRefreshPayload } from "../../../packages/reactor/src/sanctions-ops.ts";
import { hashWallet } from "../../../packages/reactor/src/sanctions-audit.ts";
import { OPERATOR_POLICY_ID } from "../../../packages/reactor/src/sanctions-policy.ts";
import { issueWalletProofChallenge } from "../../../packages/reactor/src/wallet-proof.ts";
import { recentAlerts } from "./alerts.ts";
import { openSanctionsStore } from "../../../packages/sanctions/src/store.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const WALLET = "0x2222222222222222222222222222222222222222";
const LISTED = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const t0 = Date.parse("2026-09-12T00:00:00.000Z");

{
  assert(isProtectedWritePath("POST", "/quote"), "quote is protected");
  assert(isProtectedWritePath("POST", "/launch/authorize"), "authorize is protected");
  assert(!isProtectedWritePath("GET", "/markets"), "public GET is not gated");
  assert(!isProtectedWritePath("GET", "/health"), "liveness is not gated");
  assert(protectedAction("/launch/admit") === "launch.admit", "admit action");
  assert(extractWallet({ headers: {}, body: { wallet: LISTED } }) === undefined, "extractWallet ignores body.wallet");
  assert(
    extractWallet({ headers: { "x-reactor-wallet": LISTED }, body: { creator: LISTED } }) === undefined,
    "extractWallet ignores header/creator claims",
  );
}

{
  assert(allowFixtureSanctionsRefresh({ REACTOR_ENV: "LOCAL" }), "LOCAL may fixture");
  assert(allowFixtureSanctionsRefresh({ SANCTIONS_FIXTURE: "1" }), "explicit test fixture outside prod-like");
  assert(!allowFixtureSanctionsRefresh({ REACTOR_ENV: "PROD" }), "PROD requires official source");
  assert(!allowFixtureSanctionsRefresh({ REACTOR_ENV: "PRODUCTION" }), "PRODUCTION requires official source");
  assert(!allowFixtureSanctionsRefresh({ REACTOR_ENV: "STAGING" }), "STAGING requires official source");
  assert(!allowFixtureSanctionsRefresh({ REACTOR_ENV: "TESTNET" }), "TESTNET requires official source");
  assert(
    !allowFixtureSanctionsRefresh({ REACTOR_ENV: "STAGING", SANCTIONS_FIXTURE: "1" }),
    "SANCTIONS_FIXTURE=1 cannot enable fixtures in STAGING",
  );
  assert(
    !allowFixtureSanctionsRefresh({ REACTOR_ENV: "TESTNET", SANCTIONS_FIXTURE: "1" }),
    "SANCTIONS_FIXTURE=1 cannot enable fixtures in TESTNET",
  );
  assert(
    !allowFixtureSanctionsRefresh({ REACTOR_ENV: "PROD", SANCTIONS_FIXTURE: "1" }),
    "SANCTIONS_FIXTURE=1 cannot enable fixtures in PROD",
  );
  assert(
    !allowFixtureSanctionsRefresh({ NODE_ENV: "production", SANCTIONS_FIXTURE: "1" }),
    "SANCTIONS_FIXTURE=1 cannot enable fixtures when NODE_ENV=production",
  );
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

  const denied = ops.gateProtectedWrite({ action: "quote", recoveredWallet: WALLET });
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
  const stale = ops.gateProtectedWrite({ action: "launch.authorize", recoveredWallet: WALLET });
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

{
  const dir = mkdtempSync(join(tmpdir(), "idx-sanctions-spoof-"));
  const ops = await createSanctionsOps(null, { REACTOR_ENV: "LOCAL" }, {
    dataDir: join(dir, "sanctions"),
    now: () => t0,
    fetchOfficialList: async () => fixtureRefreshPayload(new Date(t0).toISOString()),
  });
  const seeded = await ops.refresh();
  assert(seeded.ok, "spoof seed");

  const recovered = await recoverOfficialSubject({
    headers: { "x-reactor-wallet": LISTED },
    body: { wallet: LISTED, creator: LISTED },
  });
  assert(recovered.address === undefined, "claimed wallets are not recovered identity");
  assert(recovered.reason === "wallet_missing", "claimed wallets without proof are wallet_missing");
  assert(recovered.source === "operator-policy", "identity source is merged #62 operator-policy.ts");

  const claimedOnly = await applySanctionsOpsGate({
    ops,
    action: "quote",
    headers: { "x-reactor-wallet": LISTED },
    body: { wallet: LISTED, creator: LISTED, recipient: LISTED, account: LISTED },
  });
  assert(!claimedOnly.ok, "HTTP gate fails closed without recovered proof");
  assert(claimedOnly.body?.reason !== "DENY_ADDRESS_BLOCKED", "spoofed listed wallet is not DENY_ADDRESS_BLOCKED");
  assert("reason" in claimedOnly.decision && claimedOnly.decision.reason === "UNAVAILABLE_WALLET_MISSING", "claimed-only is wallet missing");
  assert(claimedOnly.audit.subject === null, "logged subject ignores claimed wallet");
  assert(claimedOnly.ignored.includes("body.wallet"), "body.wallet ignored");
  assert(claimedOnly.ignored.includes("x-reactor-wallet"), "x-reactor-wallet ignored");

  const recoveredClear = ops.gateProtectedWrite({
    action: "quote",
    recoveredWallet: WALLET,
    headers: { "x-reactor-wallet": LISTED },
    body: { wallet: LISTED, creator: LISTED },
  });
  assert(recoveredClear.ok, "test-injected recovered clear wallet is not gated by claimed listed wallet");
  assert(recoveredClear.audit.subject === hashWallet(WALLET), "logged subject is recovered");
  assert(recoveredClear.ignored.includes("body.creator"), "creator claim ignored");

  const env = { REACTOR_ENV: "LOCAL", ADMISSION_HMAC_SECRET: "test-operator-policy-hmac-secret" } as NodeJS.ProcessEnv;
  const signer = privateKeyToAccount(generatePrivateKey());
  const issued = issueWalletProofChallenge({
    chainId: walletProofChainId(env),
    secret: walletProofSecret(env),
  });
  const signature = await signer.signMessage({ message: issued.message });
  const proof = await recoverOfficialSubject({
    headers: {
      "x-reactor-wallet": LISTED,
      "x-reactor-wallet-proof": JSON.stringify({ token: issued.token, signature }),
    },
    body: { wallet: LISTED, creator: LISTED },
    env,
  });
  assert(proof.address === signer.address.toLowerCase(), "verified subject is recovered signer, not claimed wallet");
  assert(proof.address !== LISTED, "listed spoof is not the recovered subject");

  const gatedProof = await applySanctionsOpsGate({
    ops,
    action: "quote",
    headers: {
      "x-reactor-wallet": LISTED,
      "x-reactor-wallet-proof": JSON.stringify({ token: issued.token, signature }),
    },
    body: { wallet: LISTED },
    env,
  });
  assert(gatedProof.ok, "recovered clear signer is allowed despite claimed listed wallet");
  assert(gatedProof.audit.subject === hashWallet(signer.address), "audit subject is recovered signer");

  rmSync(dir, { recursive: true, force: true });
}

{
  const root = mkdtempSync(join(tmpdir(), "idx-sanctions-fixture-env-"));
  const cases: Array<{ env: NodeJS.ProcessEnv; allow: boolean; label: string }> = [
    { env: { REACTOR_ENV: "LOCAL" }, allow: true, label: "LOCAL" },
    { env: { REACTOR_ENV: "STAGING" }, allow: false, label: "STAGING" },
    { env: { REACTOR_ENV: "TESTNET" }, allow: false, label: "TESTNET" },
    { env: { REACTOR_ENV: "PROD" }, allow: false, label: "PROD" },
    { env: { REACTOR_ENV: "PRODUCTION" }, allow: false, label: "PRODUCTION" },
    { env: { REACTOR_ENV: "STAGING", SANCTIONS_FIXTURE: "1" }, allow: false, label: "STAGING+FIXTURE" },
    { env: { REACTOR_ENV: "TESTNET", SANCTIONS_FIXTURE: "1" }, allow: false, label: "TESTNET+FIXTURE" },
  ];
  for (const c of cases) {
    const dir = join(root, c.label.replace(/\+/g, "-"));
    const ops = await createSanctionsOps(null, c.env, { dataDir: dir, now: () => t0 });
    const result = await ops.refresh();
    if (c.allow) {
      assert(result.ok, `${c.label} may use LOCAL fixture refresh`);
    } else {
      assert(!result.ok, `${c.label} must not fixture-fallback`);
      assert(/not configured|official/i.test("error" in result ? result.error : ""), `${c.label} error ${"error" in result ? result.error : ""}`);
      const gated = ops.gateProtectedWrite({ action: "quote", recoveredWallet: WALLET });
      assert(!gated.ok, `${c.label} writes fail closed without official source`);
      assert(
        gated.body?.reason === "UNAVAILABLE_DATASET_MISSING" || gated.body?.reason === "UNAVAILABLE_DATASET_STALE",
        `${c.label} public reason ${gated.body?.reason}`,
      );
    }
  }
  rmSync(root, { recursive: true, force: true });
}

{
  const officialDir = mkdtempSync(join(tmpdir(), "idx-ops-official-local-"));
  const opsDir = join(officialDir, "ops-pointer");
  const store = openSanctionsStore({ dataDir: officialDir });
  assert(!store.active(), "empty official store before LOCAL fixture bind");
  const ops = await createSanctionsOps(
    null,
    { REACTOR_ENV: "LOCAL", SANCTIONS_NETWORK: "" },
    { dataDir: opsDir, now: () => t0, officialStore: store },
  );
  const start = await ops.startup();
  assert(start.refresh?.ok, "LOCAL official-store bind loads pinned #61 fixtures");
  assert(ops.health().freshness === "current", "ops freshness is current after LOCAL fixture bind");
  assert(store.active(), "shared #61 store activated so /sanctions/screen stays in sync");
  const allow = ops.gateProtectedWrite({ action: "upload", recoveredWallet: WALLET });
  assert(allow.ok, "current LOCAL fixture allows a recovered write");
  assert(
    !allowFixtureSanctionsRefresh({ REACTOR_ENV: "STAGING", SANCTIONS_NETWORK: "" }),
    "STAGING official-store bind still refuses fixtures",
  );
  rmSync(officialDir, { recursive: true, force: true });
}

{
  const dir = mkdtempSync(join(tmpdir(), "idx-sanctions-generation-"));
  const t1 = Date.parse("2026-09-12T12:00:00.000Z");
  const t0Iso = new Date(t0).toISOString();
  const t1Iso = new Date(t1).toISOString();
  const first = await createSanctionsOps(null, { REACTOR_ENV: "LOCAL" }, {
    dataDir: dir,
    now: () => t0,
    fetchOfficialList: async () => fixtureRefreshPayload(t0Iso),
  });
  const seed = await first.refresh();
  assert(seed.ok, "t0 indexer refresh");
  const id0 = seed.ok ? seed.version.id : "";

  const official = adaptOfficialRefreshPayload({
    version: {
      id: "ofac-official-gen-t1",
      retrievedAt: t1Iso,
      sources: fixtureRefreshPayload(t1Iso).sources,
      sourceGenerationHash: "official-generation-t1",
    },
    index: fixtureRefreshPayload(t1Iso).addresses,
  });
  const second = await createSanctionsOps(null, { REACTOR_ENV: "LOCAL" }, {
    dataDir: dir,
    now: () => t1,
    fetchOfficialList: async () => official,
  });
  const refreshed = await second.refresh();
  assert(refreshed.ok, "t1 same-address official refresh");
  assert(refreshed.ok && refreshed.version.id === "ofac-official-gen-t1", "indexer adapter preserves official generation id");
  assert(refreshed.ok && refreshed.version.id !== id0, "indexer does not collapse to address-only id");

  const restarted = await createSanctionsOps(null, { REACTOR_ENV: "LOCAL" }, {
    dataDir: dir,
    now: () => t1,
  });
  assert(restarted.health().dataset.retrievedAt === t1Iso, "new process freshness ages from t1");
  assert(restarted.health().dataset.versionId === "ofac-official-gen-t1", "new process loads official generation");
  assert(restarted.health().freshness === "current", "t1 is still inside SLA after restart");

  rmSync(dir, { recursive: true, force: true });
}

{
  const officialDir = mkdtempSync(join(tmpdir(), "idx-sanctions-official-"));
  const opsDir = mkdtempSync(join(tmpdir(), "idx-sanctions-opsdir-"));
  const t1 = Date.parse("2026-09-12T12:00:00.000Z");
  const t1Iso = new Date(t1).toISOString();
  let active: ReturnType<typeof adaptOfficialRefreshPayload> | null = null;
  const shared = {
    active: () =>
      active
        ? {
            version: {
              id: "ofac-shared-gen-t1",
              retrievedAt: active.retrievedAt,
              sources: active.sources,
              contentHash: "2146004f67043f8a16d67a53f75c50b514aa457d992db3f01c58225be21761ac",
              sourceGenerationHash: "shared-generation-t1",
            },
            index: new Map(active.addresses.map((a) => [a.canonicalKey, a])),
          }
        : null,
  };
  let refreshCalls = 0;
  const fetchOfficial = bindOfficialRefresh(shared, async (store) => {
    refreshCalls += 1;
    active = adaptOfficialRefreshPayload({
      version: {
        id: "ofac-shared-gen-t1",
        retrievedAt: t1Iso,
        sources: fixtureRefreshPayload(t1Iso).sources,
        sourceGenerationHash: "shared-generation-t1",
      },
      index: fixtureRefreshPayload(t1Iso).addresses,
    });
    assert(store.active()?.version.id === "ofac-shared-gen-t1", "shared store updated before adapt");
    return { ok: true, version: { id: "ofac-shared-gen-t1" } };
  });
  const ops = await createSanctionsOps(null, { REACTOR_ENV: "LOCAL", SANCTIONS_DATA_DIR: officialDir }, {
    dataDir: opsDir,
    now: () => t1,
    officialStore: shared,
    fetchOfficialList: fetchOfficial,
  });
  const out = await ops.refresh();
  assert(out.ok, "shared official store refresh");
  assert(refreshCalls === 1, "official refresh used the bound store");
  assert(shared.active()?.version.retrievedAt === t1Iso, "lookup store stays on t1 generation");
  assert(ops.health().dataset.versionId === "ofac-shared-gen-t1", "ops health uses official generation");
  assert(opsDir !== officialDir, "ops persist dir is not the official ingest dir");
  rmSync(officialDir, { recursive: true, force: true });
  rmSync(opsDir, { recursive: true, force: true });
}

console.log("indexer sanctions-ops tests ok");
