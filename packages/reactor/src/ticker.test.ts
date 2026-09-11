import assert from "node:assert/strict";
import { isReservedTicker, normalizeTicker, tryNormalizeTicker } from "./ticker.ts";

assert.equal(normalizeTicker("zcat"), "ZCAT");
assert.equal(normalizeTicker("A1B2"), "A1B2");
assert.equal(tryNormalizeTicker("zc at").ok, false);
assert.equal(tryNormalizeTicker("ZC-AT").ok, false);
assert.equal(tryNormalizeTicker("").ok, false);
assert.equal(tryNormalizeTicker("TOOLONG1234").ok, false);
assert.equal(tryNormalizeTicker("ZÇAT").ok, false);
assert.equal(isReservedTicker("usdc"), true);
assert.equal(isReservedTicker("core"), true);
assert.equal(isReservedTicker("moon"), false);
console.log("ticker tests ok");
