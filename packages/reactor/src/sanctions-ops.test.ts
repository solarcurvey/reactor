import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALERT_POLICY_FAILED,
  ALERT_REFRESH_FAILED,
  ALERT_STALE_DATASET,
  GEO_POLICY_VERSION_DEFAULT,
  OfficialListRegistry,
  SANCTIONS_DATASET_SLA_MS,
  SANCTIONS_REFRESH_FAILURE_ALERT_THRESHOLD,
  SanctionsOps,
  assessDatasetFreshness,
  completenessError,
  fixtureRefreshPayload,
  reviewOverride,
} from "./sanctions-ops.ts";
import { OPERATOR_POLICY_ID } from "./sanctions-policy.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const WALLET = "0x1111111111111111111111111111111111111111";
const t0 = Date.parse("2026-09-12T00:00:00.000Z");

{
  assert(assessDatasetFreshness(null) === "missing", "null retrieved is missing");
  assert(assessDatasetFreshness("2026-09-12T00:00:00.000Z", { now: () => t0 + 60_000 }) === "current", "fresh is current");
  assert(
    assessDatasetFreshness("2026-09-12T00:00:00.000Z", { now: () => t0 + SANCTIONS_DATASET_SLA_MS + 1 }) === "stale",
    "past SLA is stale",
  );
  assert(assessDatasetFreshness("not-a-date") === "stale", "unparseable retrieved is stale not clear");
}

{
  const dir = mkdtempSync(join(tmpdir(), "sanctions-lkg-"));
  let now = t0;
  const ops = new SanctionsOps({
    dataDir: dir,
    now: () => now,
    fetchOfficialList: async () => fixtureRefreshPayload(new Date(now).toISOString()),
  });
  const first = await ops.refresh();
  assert(first.ok, `first refresh ok: ${"error" in first ? first.error : ""}`);
  const goodId = first.ok ? first.version.id : "";
  const pointerBefore = readFileSync(join(dir, "current.json"), "utf8");

  ops.setFetcher(async () => {
    throw new Error("partial download");
  });
  const failed = await ops.refresh();
  assert(!failed.ok, "thrown fetch is a failed refresh");
  assert(failed.preservedVersion?.id === goodId, "failure reports last-known-good");
  assert(ops.registry.active()?.version.id === goodId, "active unchanged after thrown fetch");
  assert(readFileSync(join(dir, "current.json"), "utf8") === pointerBefore, "current.json bytes unchanged after bad refresh");

  ops.setFetcher(async () => ({
    retrievedAt: new Date(now).toISOString(),
    addresses: [],
    sources: [],
  }));
  const empty = await ops.refresh();
  assert(!empty.ok, "empty replacement rejected");
  assert(ops.registry.active()?.version.id === goodId, "last-known-good after empty");

  const good = fixtureRefreshPayload(new Date(now).toISOString());
  ops.setFetcher(async () => ({
    ...good,
    addresses: good.addresses.slice(0, 1),
    sources: good.sources.map((s) => ({ ...s, byteLength: 100 })),
  }));
  const truncated = await ops.refresh();
  assert(!truncated.ok, "gutted replacement rejected");
  assert(/floor|shrank|omitted|addresses/i.test(truncated.ok ? "" : truncated.error), `completeness: ${"error" in truncated ? truncated.error : ""}`);
  assert(ops.registry.active()?.version.id === goodId, "last-known-good after truncated payload");
  assert(readFileSync(join(dir, "current.json"), "utf8") === pointerBefore, "pointer unchanged after truncated");

  ops.setInject("partial_refresh");
  ops.setFetcher(async () => fixtureRefreshPayload(new Date(now).toISOString()));
  const injectedPartial = await ops.refresh();
  assert(!injectedPartial.ok, "failure-inject partial_refresh keeps last-known-good");
  assert(ops.registry.active()?.version.id === goodId, "active still good after inject partial");
  ops.setInject("none");

  rmSync(dir, { recursive: true, force: true });
}

{
  const prior = {
    version: {
      id: "ofac-aaaa",
      retrievedAt: "2026-09-12T00:00:00.000Z",
      sources: [
        {
          id: "ofac-sdn-xml",
          url: "https://www.treasury.gov/ofac/downloads/sdn.xml",
          format: "sdn_xml",
          retrievedAt: "2026-09-12T00:00:00.000Z",
          contentHash: "aa",
          byteLength: 10_000,
          httpStatus: 200,
        },
      ],
      contentHash: "aa",
      parserVersion: "1.0.0",
      addressCount: 10,
      slaId: "ofac-official-list-v1" as const,
      slaMs: SANCTIONS_DATASET_SLA_MS,
    },
    addresses: [],
  };
  const payload = fixtureRefreshPayload("2026-09-12T01:00:00.000Z", 1, 100);
  const err = completenessError(payload, prior);
  assert(err, "gutted payload has completeness error");
  assert(completenessError(payload, prior, { allowCatastrophicShrink: true }) === null, "explicit shrink is the exceptional path");
}

{
  const dir = mkdtempSync(join(tmpdir(), "sanctions-stale-write-"));
  let now = t0;
  const ops = new SanctionsOps({
    dataDir: dir,
    now: () => now,
    fetchOfficialList: async () => fixtureRefreshPayload(new Date(now).toISOString()),
  });
  const first = await ops.refresh();
  assert(first.ok, "seed dataset");
  const allow = ops.gateProtectedWrite({ action: "quote", wallet: WALLET });
  assert(allow.ok && allow.decision.decision === "allow", "fresh dataset allows protected write");
  assert(allow.ranDownstream, "fresh allow may continue");

  now = t0 + SANCTIONS_DATASET_SLA_MS + 1;
  const stale = ops.gateProtectedWrite({ action: "quote", wallet: WALLET });
  assert(!stale.ok, "stale dataset fails protected write");
  assert(stale.status === 503, `stale is 503, got ${stale.status}`);
  assert("reason" in stale.decision && stale.decision.reason === "UNAVAILABLE_DATASET_STALE", `stale reason ${"reason" in stale.decision ? stale.decision.reason : ""}`);
  assert(stale.ranDownstream === false, "stale must not reach signer/upload");
  assert(stale.body?.reason === "UNAVAILABLE_DATASET_STALE", "public body uses #62 reason");

  const admit = ops.gateProtectedWrite({ action: "launch.admit", wallet: WALLET });
  assert(!admit.ok && "reason" in admit.decision && admit.decision.reason === "UNAVAILABLE_DATASET_STALE", "admit fails closed when stale");
  const auth = ops.gateProtectedWrite({ action: "launch.authorize", wallet: WALLET });
  assert(!auth.ok && "reason" in auth.decision && auth.decision.reason === "UNAVAILABLE_DATASET_STALE", "authorize fails closed when stale");
  const upload = ops.gateProtectedWrite({ action: "upload", wallet: WALLET });
  assert(!upload.ok && "reason" in upload.decision && upload.decision.reason === "UNAVAILABLE_DATASET_STALE", "upload fails closed when stale");

  rmSync(dir, { recursive: true, force: true });
}

{
  const dir = mkdtempSync(join(tmpdir(), "sanctions-health-"));
  const now = t0;
  const ops = new SanctionsOps({
    dataDir: dir,
    now: () => now,
    geoPolicyVersion: GEO_POLICY_VERSION_DEFAULT,
    fetchOfficialList: async () => fixtureRefreshPayload(new Date(now).toISOString()),
  });
  const first = await ops.refresh();
  assert(first.ok, "health seed");
  const h = ops.health();
  assert(first.ok && h.dataset.versionId === first.version.id, "health names exact dataset version");
  assert(typeof h.dataset.contentHash === "string" && h.dataset.contentHash.length === 64, "health names content hash");
  assert(h.policy.operatorPolicyVersion === OPERATOR_POLICY_ID, "health names operator policy version");
  assert(h.policy.geoPolicyVersion === GEO_POLICY_VERSION_DEFAULT, "health names geo policy version");
  assert(h.slaId === "ofac-official-list-v1", "SLA id present");
  assert(h.freshness === "current", "fresh health");
  assert(h.dataset.lastSuccessfulRefreshAt, "last successful refresh recorded");
  rmSync(dir, { recursive: true, force: true });
}

{
  const dir = mkdtempSync(join(tmpdir(), "sanctions-alerts-"));
  let now = t0;
  const raised: string[] = [];
  const ops = new SanctionsOps({
    dataDir: dir,
    now: () => now,
    fetchOfficialList: async () => fixtureRefreshPayload(new Date(now).toISOString()),
    raiseAlert: (a) => {
      raised.push(a.code);
    },
  });
  await ops.refresh();
  ops.setFetcher(async () => {
    throw new Error("treasury timeout");
  });
  for (let i = 0; i < SANCTIONS_REFRESH_FAILURE_ALERT_THRESHOLD; i++) {
    const r = await ops.refresh();
    assert(!r.ok, "injected fail");
    assert(ops.registry.active(), "last-known-good retained across repeated failures");
  }
  assert(raised.includes(ALERT_REFRESH_FAILED), `repeated refresh failure alerts: ${raised}`);
  assert(ops.health().degraded, "repeated failure degrades health");
  assert(ops.health().refresh.consecutiveFailures >= SANCTIONS_REFRESH_FAILURE_ALERT_THRESHOLD, "consecutive failures counted");

  now = t0 + SANCTIONS_DATASET_SLA_MS + 5_000;
  raised.length = 0;
  await ops.emitHealthAlerts();
  assert(raised.includes(ALERT_STALE_DATASET), "stale dataset alerts");
  assert(ops.health().freshness === "stale", "clock past SLA is stale");
  assert(ops.health().degraded, "stale degrades health");

  ops.setInject("policy_fail");
  raised.length = 0;
  await ops.emitHealthAlerts();
  assert(raised.includes(ALERT_POLICY_FAILED), "policy-service failure alerts");
  const denied = ops.gateProtectedWrite({ action: "quote", wallet: WALLET });
  assert(!denied.ok, "policy inject fails closed");
  assert(denied.ranDownstream === false, "policy inject does not continue");

  rmSync(dir, { recursive: true, force: true });
}

{
  const complaint = reviewOverride({ kind: "user_complaint", reason: "please unlist me" });
  assert(!complaint.ok && complaint.error === "NO_AUTOMATED_OVERRIDE", "complaint is not an override");
  const explicit = reviewOverride({ kind: "operator_explicit", reason: "false-positive review", operatorId: "keeper-oncall" });
  assert(explicit.ok && explicit.applied === false && explicit.queued === true, "explicit path is review-only, not a delist");
}

{
  const dir = mkdtempSync(join(tmpdir(), "sanctions-disable-"));
  const logs: string[] = [];
  const ops = new SanctionsOps({
    dataDir: dir,
    now: () => t0,
    fetchOfficialList: async () => fixtureRefreshPayload(new Date(t0).toISOString()),
    log: (line) => logs.push(line),
  });
  await ops.refresh();
  ops.setOperatedWritesEnabled(false, "oncall@reactor");
  const gated = ops.gateProtectedWrite({ action: "launch.authorize", wallet: WALLET });
  assert(!gated.ok && "reason" in gated.decision && gated.decision.reason === "OPERATED_WRITES_DISABLED", "emergency disable");
  assert(gated.ranDownstream === false, "disabled writes do not continue");
  const review = ops.requestOverride({ kind: "user_complaint", wallet: WALLET, reason: "i am not listed" });
  assert(!review.ok, "complaint still rejected after disable");
  rmSync(dir, { recursive: true, force: true });
}

{
  const dir = mkdtempSync(join(tmpdir(), "sanctions-startup-"));
  const registry = new OfficialListRegistry({ dataDir: dir, now: () => t0 });
  const seed = registry.activate(fixtureRefreshPayload(new Date(t0).toISOString()));
  assert(seed.ok, "disk seed");
  const goodId = seed.ok ? seed.snapshot.version.id : "";
  const ops = new SanctionsOps({
    dataDir: dir,
    now: () => t0,
    fetchOfficialList: async () => {
      throw new Error("startup treasury down");
    },
  });
  const start = await ops.startup();
  assert(start.refresh && !start.refresh.ok, "startup refresh failure is surfaced");
  assert(ops.registry.active()?.version.id === goodId, "startup failure keeps last-known-good");
  assert(start.health.degraded, "startup failure degrades status");
  rmSync(dir, { recursive: true, force: true });
}

console.log("sanctions-ops tests ok");
