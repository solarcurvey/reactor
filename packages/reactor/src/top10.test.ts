import {
  rankTop10,
  materialUncertainty,
  fdvQuoteRaw,
  vwapFdvQuoteRaw,
  lastGoodFdvQuote,
  vwapPriceQuoteX18,
  lastGoodPriceQuoteX18,
  isCoreToken,
  acceptTop10Snapshot,
  isSnapshotFresh,
  snapshotAgeSec,
  staleSnapshotReason,
  MIN_VWAP_SAMPLES,
  MARK_WINDOW_SEC,
  TOP10_SNAPSHOT_TTL_SEC,
  TOP10_FLOOR_USDC,
} from "./top10.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function c(partial: Partial<Parameters<typeof rankTop10>[0][number]> & { token: string }) {
  return {
    graduated: true,
    isCore: false,
    markUsdc: 0n,
    markOk: false,
    ...partial,
  };
}

{
  const { rows, pauseEpoch } = rankTop10([c({ token: "0x1", graduated: false })]);
  assert(rows.length === 0 && !pauseEpoch, "ungraduated never ranks");
}
{
  const { rows } = rankTop10([c({ token: "0xcore", isCore: true, markUsdc: 9_000_000n * 1_000_000n, markOk: true })]);
  assert(rows.length === 0, "CORE never ranks");
}
{
  const { rows, pauseEpoch } = rankTop10([
    c({ token: "0x1", markUsdc: 400_000n * 1_000_000n, markOk: true }),
    c({ token: "0x2", markUsdc: 0n, markOk: false, priorRanked: true }),
  ]);
  assert(rows.length === 0 && pauseEpoch, "material unvalued graduate pauses");
}
{
  const { rows, pauseEpoch } = rankTop10([
    c({ token: "0x1", markUsdc: 400_000n * 1_000_000n, markOk: true }),
    c({ token: "0x2", markUsdc: 0n, markOk: false, lastGoodMarkUsdc: 8_000n * 1_000_000n }),
  ]);
  assert(rows.length === 1 && !pauseEpoch, "irrelevant inactivity must not freeze");
}
{
  assert(materialUncertainty(c({ token: "0x1", lastGoodMarkUsdc: 250_000n * 1_000_000n })), "floor lastGood is material");
}
{
  const floorFifth = TOP10_FLOOR_USDC / 5n;
  const { rows, pauseEpoch } = rankTop10([
    c({ token: "0x1", markUsdc: 400_000n * 1_000_000n, markOk: true }),
    c({ token: "0x2", markUsdc: 0n, markOk: false, lastGoodMarkUsdc: 0n, liquidityUsdc: floorFifth }),
  ]);
  assert(rows.length === 0 && pauseEpoch, "indexed liquidity arm pauses independently of lastGood");
}
{
  const { rows, pauseEpoch } = rankTop10([
    c({ token: "0x1", markUsdc: 400_000n * 1_000_000n, markOk: true }),
    c({
      token: "0x2",
      markUsdc: 0n,
      markOk: false,
      lastGoodMarkUsdc: 8_000n * 1_000_000n,
      liquidityUsdc: TOP10_FLOOR_USDC / 5n - 1n,
    }),
  ]);
  assert(rows.length === 1 && !pauseEpoch, "immaterial liquidity must not freeze");
}
{
  const now = 2_000_000;
  assert(isSnapshotFresh(now, now + TOP10_SNAPSHOT_TTL_SEC), "TTL inclusive");
  assert(!isSnapshotFresh(now, now + TOP10_SNAPSHOT_TTL_SEC + 1), "age past TTL is stale");
  assert(!isSnapshotFresh(undefined, now), "missing computedTs is stale");
  assert(snapshotAgeSec(0, now) === Number.POSITIVE_INFINITY, "zero computedTs is infinitely old");
  const fresh = acceptTop10Snapshot({ pauseEpoch: false, computedTs: now }, now + 10);
  assert(fresh.ok, "fresh healthy snapshot accepted");
  const paused = acceptTop10Snapshot({ pauseEpoch: true, computedTs: now, reason: "paused" }, now);
  assert(!paused.ok && paused.reason === "paused", "pauseEpoch refuses even when fresh");
  const stale = acceptTop10Snapshot({ pauseEpoch: false, computedTs: now }, now + TOP10_SNAPSHOT_TTL_SEC + 1);
  assert(!stale.ok && stale.reason === staleSnapshotReason(TOP10_SNAPSHOT_TTL_SEC + 1), "Keeper refuses stale healthy");
}
{
  const Q96 = 1n << 96n;
  const fdv = fdvQuoteRaw(Q96, 1_000n, true);
  assert(fdv === 1_000n, `1:1 sqrt should mark supply as quote: ${fdv}`);
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
  assert(!vwapFdvQuoteRaw(samples.slice(0, 1), 1_000n, true, now).ok, "thin window fail-closed");
}
{
  const now = 2_000_000;
  const px = 2n * 10n ** 18n;
  const samples = [0, 30, 60].map((d) => ({ notional: 100n, priceQuoteX18: px, ts: now - d }));
  const v = vwapPriceQuoteX18(samples, now);
  assert(v.ok && v.priceX18 === px, `price vwap ${v.priceX18}`);
  const hist = [0, 30, 60].map((d) => ({
    notional: 100n,
    priceQuoteX18: px,
    ts: now - MARK_WINDOW_SEC - 10 - d,
  }));
  assert(lastGoodPriceQuoteX18(hist, now) === px, "lastGood price from 3 historical samples");
  assert(lastGoodFdvQuote(hist.map((s) => ({ notional: s.notional, sqrtPrice: 1n << 96n, ts: s.ts })), 1_000n, true, now) === 1_000n, "lastGood fdv");
}
{
  assert(isCoreToken("0xABC", ["0xabc"]), "core match");
  assert(!isCoreToken("0xdef", ["0xabc"]), "non-core");
}

console.log("top10 package tests ok");
