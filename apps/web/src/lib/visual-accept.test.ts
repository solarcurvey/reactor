import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const accept = JSON.parse(readFileSync(join(root, "docs/visual-accept.json"), "utf8")) as {
  issue: number;
  coordinateIssue: number;
  coordinatePr: number;
  viewports: number[];
  surfaces: string[];
  states: string[];
  acceptedCommit: string;
  acceptedUiHash: string;
};

assert.equal(accept.issue, 40);
assert.equal(accept.coordinateIssue, 36);
assert.equal(accept.coordinatePr, 49);
assert.deepEqual(accept.viewports, [1440, 390]);
assert.ok(accept.surfaces.includes("discover") && accept.surfaces.includes("reactor") && accept.surfaces.includes("core"));
assert.deepEqual([...accept.states].sort(), ["empty", "error", "loading", "offline"]);

const files = [
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/search/page.tsx",
  "apps/web/src/app/reactor/page.tsx",
  "apps/web/src/app/core/page.tsx",
  "apps/web/src/app/quote/[symbol]/page.tsx",
  "apps/web/src/app/token/[address]/page.tsx",
  "apps/web/src/components/token-card.tsx",
  "apps/web/src/components/query-state.tsx",
];
const h = createHash("sha256");
for (const f of files) h.update(f);
for (const f of files) h.update(readFileSync(join(root, f)));
const uiHash = h.digest("hex");
assert.equal(
  accept.acceptedUiHash,
  uiHash,
  `Visual gate hash drifted — re-accept desktop/mobile on this commit and coordinate with #36. got ${uiHash}`,
);

if (process.env.VISUAL_GATE_STRICT === "1") {
  const head = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
  assert.equal(accept.acceptedCommit, head, "VISUAL_GATE_STRICT requires acceptedCommit === HEAD");
}

console.log("visual-accept ok", uiHash.slice(0, 12));
