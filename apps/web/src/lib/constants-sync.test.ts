import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const constants = readFileSync(join(root, "contracts/src/ReactorConstants.sol"), "utf8");
const docs = [
  readFileSync(join(root, "docs/index.md"), "utf8"),
  readFileSync(join(root, "docs/api.md"), "utf8"),
  readFileSync(join(root, "README.md"), "utf8"),
].join("\n");
assert.match(constants, /PROTOCOL_FEE_BPS = 350/);
assert.match(constants, /HOLDER_FEE_BPS = 200/);
assert.match(docs, /3\.5%/);
assert.match(docs, /2% holders/);
assert.doesNotMatch(docs, /audited and trustless/i);
console.log("docs constant sync ok");
