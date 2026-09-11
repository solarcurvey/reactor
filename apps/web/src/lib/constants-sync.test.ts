import assert from "node:assert/strict";
import { check } from "../../../../scripts/sync-docs.ts";

const errors = check();
assert.equal(errors.length, 0, errors.join("\n"));
console.log("docs/constants/version/deployments sync ok");
