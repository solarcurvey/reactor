import { mkdirSync } from "node:fs";
import { OFFICIAL_SOURCES } from "./sources.ts";
import { openSanctionsStore } from "./store.ts";
import { refreshSanctions } from "./refresh.ts";
import { pinnedFixtureBodies } from "./fixtures.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

const cmd = process.argv[2] ?? "help";
const dataDir = arg("--dir", process.env.SANCTIONS_DATA_DIR ?? new URL("../data", import.meta.url).pathname)!;

if (cmd === "help" || cmd === "-h" || cmd === "--help") {
  console.log(`@reactor/sanctions — exact official-list address screening (not legal/OFAC compliance)

  tsx src/cli.ts refresh [--dir PATH] [--fixtures] [--all-sources]
  tsx src/cli.ts screen <address> [--dir PATH] [--family evm]
  tsx src/cli.ts version [--dir PATH]

Official sources (HTTPS, Treasury/OFAC only):
${OFFICIAL_SOURCES.map((s) => `  ${s.id}\n    ${s.url}`).join("\n")}
`);
  process.exit(0);
}

const store = openSanctionsStore({
  dataDir,
  maxAgeMs: Number(process.env.SANCTIONS_MAX_AGE_MS ?? 7 * 24 * 60 * 60 * 1000),
});

if (cmd === "version") {
  console.log(JSON.stringify({ freshness: store.freshness(), datasetVersion: store.active()?.version ?? null }, null, 2));
  process.exit(0);
}

if (cmd === "screen") {
  const address = process.argv[3];
  if (!address) {
    console.error("address required");
    process.exit(2);
  }
  const family = arg("--family") as never;
  console.log(JSON.stringify(store.screen(address, family ? { family } : {}), null, 2));
  process.exit(0);
}

if (cmd === "refresh") {
  mkdirSync(dataDir, { recursive: true });
  const result = has("--fixtures")
    ? await refreshSanctions(store, {
        sourceIds: ["ofac-sdn-xml", "ofac-sdn-advanced-xml", "ofac-consolidated-xml"],
        bodies: pinnedFixtureBodies(),
        validation: { minAddresses: 1, rejectIfFewerThanPriorRatio: 0 },
      })
    : await refreshSanctions(store, {
        sourceIds: has("--all-sources") ? OFFICIAL_SOURCES.map((s) => s.id) : undefined,
      });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

console.error(`unknown command: ${cmd}`);
process.exit(2);
