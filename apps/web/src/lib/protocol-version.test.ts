import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FACTORY_VERSION_LABEL, PROTOCOL_VERSION, RELEASE_TAG } from "./protocol-version.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ver = JSON.parse(readFileSync(join(root, "docs/version.json"), "utf8")) as {
  protocolVersion: string;
  factoryVersionLabel: string;
  releaseTag: string;
};

assert.equal(PROTOCOL_VERSION, ver.protocolVersion);
assert.equal(FACTORY_VERSION_LABEL, ver.factoryVersionLabel);
assert.equal(RELEASE_TAG, ver.releaseTag);
console.log("protocol-version ok");
