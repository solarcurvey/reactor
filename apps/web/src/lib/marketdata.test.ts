import { fdvQuoteRaw, vwapFdvQuoteRaw, lastGoodFdvQuote, MIN_VWAP_SAMPLES, MARK_WINDOW_SEC, consumeIndexerValuation } from "./marketdata.ts";
import { rankTop10 } from "./top10.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const Q96 = 1n << 96n;
  const fdv = fdvQuoteRaw(Q96, 1_000n, true);
  assert(fdv === 1_000n, `1:1 sqrt should mark supply as quote: ${fdv}`);
}

{
  const { rows, pauseEpoch } = rankTop10([
    { token: "0x1", graduated: true, isCore: false, markUsdc: 0n, markOk: false, lastGoodMarkUsdc: 400_000n * 1_000_000n },
    { token: "0x2", graduated: false, isCore: false, markUsdc: 9_000_000n * 1_000_000n, markOk: true },
  ]);
  assert(rows.length === 0 && pauseEpoch, "material unreliable-only set must pause, never guess");
}

{
  const { rows, pauseEpoch } = rankTop10([
    { token: "0x1", graduated: true, isCore: false, markUsdc: 400_000n * 1_000_000n, markOk: true },
    { token: "0x2", graduated: true, isCore: false, markUsdc: 0n, markOk: false, priorRanked: true },
  ]);
  assert(rows.length === 0 && pauseEpoch, "material unvalued graduate pauses the epoch");
}

{
  const { rows, pauseEpoch } = rankTop10([
    { token: "0x1", graduated: true, isCore: false, markUsdc: 400_000n * 1_000_000n, markOk: true },
    { token: "0x2", graduated: true, isCore: false, markUsdc: 0n, markOk: false, tradeCount: 1, lastGoodMarkUsdc: 8_000n * 1_000_000n },
  ]);
  assert(rows.length === 1 && !pauseEpoch, "irrelevant inactivity must not freeze");
}

{
  const Q96 = 1n << 96n;
  const now = 1_000_000;
  const samples = Array.from({ length: MIN_VWAP_SAMPLES }, (_, i) => ({
    notional: 100n,
    sqrtPrice: Q96,
    ts: now - 60 * i,
  }));
  const v = vwapFdvQuoteRaw(samples, 1_000n, true, now);
  assert(v.ok && v.fdv === 1_000n, `vwap 1:1 ${v.fdv}`);
  const thin = vwapFdvQuoteRaw(samples.slice(0, 1), 1_000n, true, now);
  assert(!thin.ok, "thin window fail-closed");
  const stale = vwapFdvQuoteRaw(
    samples.map((s) => ({ ...s, ts: now - 3600 })),
    1_000n,
    true,
    now,
  );
  assert(!stale.ok, "stale window fail-closed");
}

{
  const { rows, pauseEpoch } = rankTop10([
    { token: "0xcore", graduated: true, isCore: true, markUsdc: 9_000_000n * 1_000_000n, markOk: true },
  ]);
  assert(rows.length === 0 && !pauseEpoch, "CORE never ranks");
}

{
  const { rows } = rankTop10([
    { token: "0xa", graduated: true, isCore: false, markUsdc: 100_000n * 1_000_000n, markOk: true },
  ]);
  assert(rows.length === 0, "$250k floor fail-closed");
}

{
  const Q96 = 1n << 96n;
  const now = 2_000_000;
  const historical = [0, 30, 60].map((d) => ({
    notional: 100n,
    sqrtPrice: Q96,
    ts: now - MARK_WINDOW_SEC - 10 - d,
  }));
  const lastGood = lastGoodFdvQuote(historical, 1_000n, true, now);
  assert(lastGood === 1_000n, `3 historical samples must produce lastGood, got ${lastGood}`);
  const two = lastGoodFdvQuote(historical.slice(0, 2), 1_000n, true, now);
  assert(two === 0n, "fewer than 3 historical samples fail closed");
}

{
  const accepted = consumeIndexerValuation({ ok: true, usd6: "50000000" }, true);
  assert(accepted !== "offline" && accepted.ok, "ranker consumes accepted ValuationService mark");
  const rejected = consumeIndexerValuation({ ok: false, usd6: "0" }, true);
  assert(rejected !== "offline" && !rejected.ok, "reachable rejected mark must not fall through to a second pricer");
  assert(consumeIndexerValuation(null, false) === "offline", "unreachable indexer is offline-only");
}

console.log("marketdata tests ok");
