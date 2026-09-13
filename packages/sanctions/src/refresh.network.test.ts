/**
 * Network-dependent official refresh.
 * Isolated from deterministic unit CI (`pnpm --filter @reactor/sanctions test`).
 * Run only with: SANCTIONS_NETWORK=1 pnpm --filter @reactor/sanctions test:network
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SanctionsStore } from "./store.ts";
import { refreshSanctions } from "./refresh.ts";
import { assertOfficialSourceUrl } from "./sources.ts";

if (process.env.SANCTIONS_NETWORK !== "1") {
  console.error("refresh.network.test.ts is isolated from unit CI. Re-run with SANCTIONS_NETWORK=1 to fetch official OFAC HTTPS.");
  process.exit(2);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assertOfficialSourceUrl("https://www.treasury.gov/ofac/downloads/sdn.xml");

const dir = mkdtempSync(join(tmpdir(), "sanctions-net-"));
try {
  const store = new SanctionsStore({ dataDir: dir });
  const result = await refreshSanctions(store, {
    sourceIds: ["ofac-sdn-xml"],
    validation: { minAddresses: 1, rejectIfFewerThanPriorRatio: 0 },
    fetch: { timeoutMs: 120_000, maxBytes: 200 * 1024 * 1024 },
  });
  assert(result.ok, `official SDN XML refresh failed: ${"error" in result ? result.error : ""}`);
  assert((result.ok && result.version.addressCount > 0) || false, "official list produced addresses");
  assert(store.active()?.version.sources[0]?.url === "https://www.treasury.gov/ofac/downloads/sdn.xml", "recorded official URL");
  console.log(`refresh.network.test.ts ok addresses=${result.ok ? result.version.addressCount : 0}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
