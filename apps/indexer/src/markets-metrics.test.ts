import assert from "node:assert/strict";
import { change24hBps, parseBoard, quoteLiquidityUsd6 } from "./markets-metrics.ts";

assert.equal(change24hBps(110n * 10n ** 16n, 100n * 10n ** 16n), "1000", "+10% is 1000 bps");
assert.equal(change24hBps(90n * 10n ** 16n, 100n * 10n ** 16n), "-1000", "−10% is -1000 bps");
assert.equal(change24hBps(1n, 0n), "", "no prior mark → empty, not invented 0");
assert.equal(quoteLiquidityUsd6(2_000_000n, 1_000_000n, 6), "2000000", "2 USDC at $1 = $2 (usd6)");
assert.equal(quoteLiquidityUsd6(0n, 1_000_000n, 6), "0", "empty quote inventory");
assert.equal(parseBoard("trending").live, "1");
assert.equal(parseBoard("trending").sortHint, "vol");
assert.equal(parseBoard("bonding").stage, "bonding");
assert.equal(parseBoard("rewards").mode, "0");
assert.equal(parseBoard("rewards").rewards, "1");
assert.equal(parseBoard("buy+burn").rewards, "0");
assert.equal(parseBoard("fair").mode, "1");
assert.equal(parseBoard("usdc-quoted").quoteSymbol, "usdc");
console.log("markets-metrics ok");
