import { priceQuoteX18, priceQuoteX18FromSqrt, usd6FromPriceQuote, fdvUsd6, applyTradeToCandle, fillContinuous, CANDLE_INTERVALS } from "./prices.ts";

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
assert(CANDLE_INTERVALS["15m"] === 900, "15m");
console.log("prices tests ok");
