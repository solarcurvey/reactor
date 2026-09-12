import {
  priceQuoteX18,
  priceQuoteX18FromSqrt,
  usd6FromPriceQuote,
  fdvUsd6,
  applyTradeToCandle,
  fillContinuous,
  fillCandlesForRequest,
  boundedCandleWindow,
  exclusiveBeforeBucket,
  CANDLE_INTERVALS,
  MAX_CANDLE_FILL_BUCKETS,
} from "./prices.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  // 1 token (18) costs 2 USDC (6) → 2e18
  const px = priceQuoteX18(2_000_000n, 10n ** 18n, 6, 18);
  assert(px === 2n * 10n ** 18n, `usdc px ${px}`);
}
{
  // 1000 tokens cost 10 ZEC (8) → 0.01 ZEC/token → 1e16
  const px = priceQuoteX18(10n * 10n ** 8n, 1000n * 10n ** 18n, 8, 18);
  assert(px === 10n ** 16n, `zec px ${px}`);
}
{
  const usd = usd6FromPriceQuote(2n * 10n ** 18n, 1_000_000n);
  assert(usd === 2_000_000n, `usd6 ${usd}`);
}
{
  const fdv = fdvUsd6(2n * 10n ** 18n, 1_000_000_000n * 10n ** 18n, 18, 1_000_000n);
  assert(fdv === 2_000_000_000n * 1_000_000n, `fdv ${fdv}`);
}
{
  const one = 1n << 96n;
  const px = priceQuoteX18FromSqrt(one, true, 18, 18);
  assert(px === 10n ** 18n, `sqrt 1:1 ${px}`);
}
{
  let c = applyTradeToCandle(undefined, 100, 60, "100", "5");
  c = applyTradeToCandle(c, 110, 60, "120", "3");
  assert(c.t === 60 && c.o === "100" && c.h === "120" && c.c === "120" && c.v === "8", JSON.stringify(c));
}
{
  const filled = fillContinuous(
    [
      { t: 0, o: "1", h: "1", l: "1", c: "1", v: "1", n: 1 },
      { t: 120, o: "2", h: "2", l: "2", c: "2", v: "1", n: 1 },
    ],
    60,
    0,
    120,
  );
  assert(filled.length === 3 && filled[1]!.c === "1" && filled[1]!.n === 0, "gap filled");
}
{
  const yearAgo = 0;
  const now = 365 * 24 * 3600;
  const sparse = [
    { t: yearAgo, o: "5", h: "5", l: "5", c: "5", v: "1", n: 1 },
    { t: now - 120, o: "9", h: "9", l: "9", c: "9", v: "1", n: 1 },
  ];
  const unboundedWouldBe = Math.floor(now / 60) + 1;
  assert(unboundedWouldBe > 10_000, "fixture is a DoS-sized 1m span");
  const filled = fillContinuous(sparse, 60, yearAgo, now);
  assert(filled.length <= MAX_CANDLE_FILL_BUCKETS, `default fill bounded ${filled.length}`);
  assert(filled.length === MAX_CANDLE_FILL_BUCKETS, "keeps most recent 1000 1m buckets");
  assert(filled[filled.length - 1]!.t === now, "recent end preserved");
  assert(filled[0]!.t === now - (MAX_CANDLE_FILL_BUCKETS - 1) * 60, "start clamped forward");
}
{
  const now = 1_700_000_000;
  const end = Math.floor(now / 60) * 60;
  const win = boundedCandleWindow({ intervalSec: 60, limit: 5, nowTs: now });
  assert(win.maxBuckets === 5 && win.toTs === end && win.fromTs === end - 4 * 60, "live window bucket-aligned");
  const before = boundedCandleWindow({ intervalSec: 300, limit: 10, nowTs: now, before: 1_000 });
  assert(before.toTs === Math.floor(1_000 / 300) * 300, "mid-bucket before keeps that bucket (t < 1000 includes 900)");
  assert(before.toTs !== now && before.toTs < now, "historical before does not extend to now");
  assert(before.fromTs === before.toTs - 9 * 300, "before window size");
  assert(exclusiveBeforeBucket(300, 60) === 240, "aligned before excludes the cursor bucket");
  assert(exclusiveBeforeBucket(301, 60) === 300, "non-aligned before includes the open bucket");
  const aligned = boundedCandleWindow({ intervalSec: 60, limit: 5, nowTs: now, before: 300 });
  assert(aligned.toTs === 240 && aligned.fromTs === 0, "aligned before window ends on previous bucket");
  assert(aligned.toTs < now, "aligned historical before never reaches now");
  const after = boundedCandleWindow({ intervalSec: 60, limit: 100, nowTs: now, after: end - 120 });
  assert(after.fromTs === end - 60, "after is exclusive of the cursor bucket");
  const capped = boundedCandleWindow({ intervalSec: 60, limit: 50_000, nowTs: now });
  assert(capped.maxBuckets === MAX_CANDLE_FILL_BUCKETS, "limit hard-capped");
}
{
  const now = 10_000;
  const end = Math.floor(now / 60) * 60;
  const rows = [
    { t: 0, o: "1", h: "1", l: "1", c: "1", v: "1", n: 1 },
    { t: 9_900, o: "3", h: "3", l: "3", c: "3", v: "1", n: 1 },
  ];
  const series = fillCandlesForRequest(rows, 60, 4, now);
  assert(series.length === 4, `request series ${series.length}`);
  assert(series[0]!.t === end - 3 * 60 && series[3]!.t === end, "request window is last limit buckets");
  assert(series.some((c) => c.t === 9_900 && c.n === 1), "real candle kept");
  assert(series.filter((c) => c.n === 0).every((c) => c.c === "3" || c.c === "1"), "gaps carry last close");
  const empty = fillCandlesForRequest([], 60, 300, now);
  assert(empty.length === 0, "no synthetic history without rows");
  const paged = fillCandlesForRequest(rows, 60, 3, now, 9_000, null);
  assert(paged[paged.length - 1]!.t === 8_940, "aligned before is exclusive (no t=9000)");
  assert(paged.every((c) => c.t < 9_000), "before excludes the cursor and the live tip");
  assert(paged.every((c) => c.t <= 8_940 && c.t < now), "historical page stays in the past");
}
{
  const now = 10_000;
  const seed = { o: "1", h: "1", l: "1", c: "1", v: "1", n: 1 };
  const sparse = [{ t: 0, ...seed }];
  const alignedFill = fillCandlesForRequest(sparse, 60, 5, now, 300, null);
  assert(!alignedFill.some((c) => c.t === 300), "aligned before synthesizes no candle at exactly before");
  assert(alignedFill.every((c) => c.t < 300), "every filled bucket is strictly before");
  assert(alignedFill[alignedFill.length - 1]!.t === 240, "last synthetic is previous bucket");
  assert(alignedFill.every((c) => c.t < now), "aligned before never fills to now");

  const dense: typeof sparse = [];
  for (let t = 0; t <= 9_960; t += 60) dense.push({ t, o: "1", h: "1", l: "1", c: String(t), v: "1", n: 1 });
  const page1 = fillCandlesForRequest(dense, 60, 4, now);
  const oldest = page1[0]!.t;
  const page2 = fillCandlesForRequest(dense, 60, 4, now, oldest, null);
  const seen = new Set(page1.map((c) => c.t));
  assert(page2.length === 4, "second page still bounded");
  assert(page2.every((c) => !seen.has(c.t)), "page N+1 has no synthetic overlap with page N");
  assert(page2.every((c) => c.t < oldest), "page N+1 is strictly older than page N");
}
assert(CANDLE_INTERVALS["15m"] === 900, "15m");
console.log("prices tests ok");
