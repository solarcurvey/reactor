import { valueQuoteUsd6, fuseExternalUsd6, CycleError, USDC_ONE } from "./valuation.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const USDC = "0xusdc";
const ZEC = "0xzec";
const EURC = "0xeurc";
const ZCAT = "0xzcat";
const CAT = "0xcat";

const nodes = new Map([
  [USDC, { token: USDC, symbol: "USDC", decimals: 6, usdPegOne: true }],
  [EURC, { token: EURC, symbol: "EURC", decimals: 6, usdPegOne: false, externalUsd6: 1_080_000n, externalOk: true }],
  [ZEC, { token: ZEC, symbol: "ZEC", decimals: 8, usdPegOne: false, externalUsd6: 50_000_000n, externalOk: true }],
  [ZCAT, { token: ZCAT, symbol: "ZCAT", decimals: 18, usdPegOne: false, parentQuote: ZEC }],
  [CAT, { token: CAT, symbol: "CAT", decimals: 18, usdPegOne: false, parentQuote: ZCAT }],
]);

{
  const v = valueQuoteUsd6(USDC, nodes);
  assert(v.ok && v.usd6 === USDC_ONE, "usdPegOne");
}
{
  const v = valueQuoteUsd6(EURC, nodes);
  assert(v.ok && v.usd6 === 1_080_000n, "EURC is not $1");
}
{
  const v = valueQuoteUsd6(CAT, nodes);
  assert(v.ok && v.usd6 === 50_000_000n, `nested CAT ${v.reason}`);
}
{
  const cyclic = new Map(nodes);
  cyclic.set(ZEC, { token: ZEC, symbol: "ZEC", decimals: 8, usdPegOne: false, parentQuote: CAT, externalOk: false });
  let threw = false;
  try {
    valueQuoteUsd6(CAT, cyclic);
  } catch (e) {
    threw = e instanceof CycleError;
  }
  assert(threw, "cycle rejected");
}
{
  const fused = fuseExternalUsd6(
    [
      { usd6: 50_000_000n, ts: 100, name: "a" },
      { usd6: 50_100_000n, ts: 100, name: "b" },
      { usd6: 49_900_000n, ts: 100, name: "arc" },
    ],
    110,
  );
  assert(fused.ok, fused.reason);
  const stale = fuseExternalUsd6([{ usd6: 50_000_000n, ts: 1, name: "a" }], 10_000);
  assert(!stale.ok, "stale");
  const dev = fuseExternalUsd6(
    [
      { usd6: 50_000_000n, ts: 100, name: "a" },
      { usd6: 80_000_000n, ts: 100, name: "manip" },
    ],
    110,
  );
  assert(!dev.ok, "spot manip rejected");
}

console.log("valuation tests ok");
