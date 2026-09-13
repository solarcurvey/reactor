import assert from "node:assert/strict";
import { authorizerHandler, relayAHandler, relayBHandler } from "./managed-relay-worker.ts";

assert.equal(typeof authorizerHandler, "function");
assert.equal(typeof relayAHandler, "function");
assert.equal(typeof relayBHandler, "function");
console.log("managed relay worker import test: ok");
