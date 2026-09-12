import { valueQuoteUsd6, fuseExternalUsd6, CycleError, USDC_ONE, ValuationService } from "./valuation.ts";

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
  // 1 ZCAT = 0.02 ZEC → $1.00
  [ZCAT, { token: ZCAT, symbol: "ZCAT", decimals: 18, usdPegOne: false, parentQuote: ZEC, priceInParentX18: 20n * 10n ** 15n }],
  // 1 CAT = 0.5 ZCAT → $0.50
  [CAT, { token: CAT, symbol: "CAT", decimals: 18, usdPegOne: false, parentQuote: ZCAT, priceInParentX18: 5n * 10n ** 17n }],
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
  assert(v.ok && v.usd6 === 500_000n, `nested CAT product ${v.usd6} ${v.reason}`);
  assert(v.ancestry.length === 3, `ancestry ${v.ancestry.length}`);
  assert(v.ancestry[0]!.symbol === "ZEC" && v.ancestry[2]!.symbol === "CAT", "ancestry order ZEC→ZCAT→CAT");
}
{
  const parentOnly = new Map(nodes);
  parentOnly.set(CAT, { token: CAT, symbol: "CAT", decimals: 18, usdPegOne: false, parentQuote: ZCAT });
  const v = valueQuoteUsd6(CAT, parentOnly);
  assert(!v.ok && v.reason.includes("parent-only"), `must refuse parent-only USD: ${v.reason}`);
}
{
  const cyclic = new Map(nodes);
  cyclic.set(ZEC, { token: ZEC, symbol: "ZEC", decimals: 8, usdPegOne: false, parentQuote: CAT, externalOk: false, priceInParentX18: 1n });
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
  const arc = fuseExternalUsd6([{ usd6: 50_000_000n, ts: 100, name: "a" }], 110, 120, 150, 10_000_000n, 400);
  assert(!arc.ok && arc.reason === "arc sanity", "arc band");
  const opts = fuseExternalUsd6(
    [
      { usd6: 50_000_000n, ts: 100, name: "a" },
      { usd6: 50_040_000n, ts: 100, name: "b" },
      { usd6: 80_000_000n, ts: 100, name: "outlier" },
    ],
    110,
    { minSources: 2, maxAgeSec: 120, maxDevBps: 150 },
  );
  assert(opts.ok && opts.rejected.some((r) => r.name === "outlier"), "drop outlier among 3");
  const short = fuseExternalUsd6([{ usd6: 50_000_000n, ts: 100, name: "only" }], 110, { minSources: 2 });
  assert(!short.ok && short.reason.includes("insufficient"), "minSources fail-closed");
}
{
  const svc = new ValuationService(nodes);
  const t = svc.tokenUsd6(2n * 10n ** 18n, USDC);
  assert(t.ok && t.usd6 === 2_000_000n, "service token mark");
  assert(!svc.degraded(), "healthy book");
}

console.log("valuation tests ok");
