import { rankTop10 } from "./top10.ts";
import { ValuationService, type QuoteNode } from "./valuation.ts";
import {
  CONSENSUS_KIND,
  CONSENSUS_SOURCE,
  StaticProvider,
  consensusForAsset,
  consensusUsd6,
  consumeIndexerValuation,
  effectiveMinSources,
  launchBlockedByValuation,
  mergePriceRegistries,
  providersFromAsset,
  usd6FromHttpBody,
  type AssetPriceConfig,
} from "./pricing.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  assert(usd6FromHttpBody({ usd6: "50000000" }, "usd6") === 50_000_000n, "usd6 parser");
  assert(usd6FromHttpBody({ price: 50.5 }, "usd") === 50_500_000n, "usd parser");
  assert(usd6FromHttpBody({ zcash: { usd: 42.1 } }, "coingecko", "zcash") === 42_100_000n, "coingecko");
  assert(usd6FromHttpBody({ data: { amount: "68000.25" } }, "coinbase") === 68_000_250_000n, "coinbase wbtc dollars");
  assert(usd6FromHttpBody({ result: { ZECUSD: { c: ["51.2"] } } }, "kraken", "ZECUSD") === 51_200_000n, "kraken");
  // WBTC dollars must not be treated as already-usd6 (legacy n<1000 heuristic).
  assert(usd6FromHttpBody({ price: 68000 }, "price") === 68_000_000_000n, "price parser large dollars");
}

{
  const zec: AssetPriceConfig = {
    token: "0xzec",
    symbol: "ZEC",
    important: true,
    sources: [
      { name: "a", kind: "http-json", url: "https://a.example/zec", parser: "usd" },
      { name: "b", kind: "http-json", url: "https://b.example/zec", parser: "usd" },
    ],
  };
  assert(effectiveMinSources(zec, true) === 2, "PROD important defaults to 2 sources");
  assert(effectiveMinSources({ ...zec, minSources: 1 }, true) === 1, "explicit minSources wins");
  const wbtc = mergePriceRegistries(
    { assets: [zec] },
    {
      assets: [
        {
          token: "0xwbtc",
          symbol: "WBTC",
          important: true,
          sources: [
            { name: "c1", kind: "http-json", url: "https://c1.example/wbtc" },
            { name: "c2", kind: "http-json", url: "https://c2.example/wbtc" },
          ],
        },
      ],
    },
  );
  assert(wbtc.assets.length === 2, "registry keyed by address, not hardcoded ZEC/WBTC branches");
}

{
  const prod = providersFromAsset(
    {
      token: "0xzec",
      symbol: "ZEC",
      sources: [{ name: "local-static", kind: "static", staticUsd6: "50000000" }],
    },
    100,
    { REACTOR_ENV: "PROD" },
  );
  assert(prod.providers.length === 0, "PROD rejects static providers");
  assert(prod.skipped[0]?.reason.includes("static forbidden"), prod.skipped[0]?.reason ?? "missing skip");
}

{
  const now = 1_000;
  const a = new StaticProvider("alpha", new Map([["ZEC", { usd6: 50_000_000n, ts: now }]]));
  const b = new StaticProvider("beta", new Map([["ZEC", { usd6: 50_100_000n, ts: now }]]));
  const fused = await consensusUsd6([a, b], "ZEC", now, { token: "0xzec", minSources: 2 });
  assert(fused.ok && fused.n === 2, fused.reason);
  assert(fused.observations.some((o) => o.kind === CONSENSUS_KIND && o.ok && o.source === CONSENSUS_SOURCE), "persist consensus");
  assert(fused.observations.filter((o) => o.source !== CONSENSUS_SOURCE && o.ok).length === 2, "persist accepted observations");
}

{
  const now = 1_000;
  const stale = new StaticProvider("old", new Map([["ZEC", { usd6: 50_000_000n, ts: 1 }]]));
  const live = new StaticProvider("live", new Map([["ZEC", { usd6: 50_000_000n, ts: now }]]));
  const out = await consensusUsd6([stale, live], "ZEC", now, { token: "0xzec", minSources: 2, maxAgeSec: 120 });
  assert(!out.ok && out.reason.includes("insufficient"), `stale drops below minSources: ${out.reason}`);
  assert(out.observations.some((o) => o.source === "old" && !o.ok && o.reason === "stale"), "persist stale reject");
}

{
  const now = 1_000;
  const a = new StaticProvider("a", new Map([["ZEC", { usd6: 50_000_000n, ts: now }]]));
  const manip = new StaticProvider("manip", new Map([["ZEC", { usd6: 80_000_000n, ts: now }]]));
  const out = await consensusUsd6([a, manip], "ZEC", now, { token: "0xzec", minSources: 2 });
  assert(!out.ok && out.reason.includes("deviation"), `two-source disagreement fail-closed: ${out.reason}`);
  assert(out.observations.some((o) => !o.ok && o.reason.includes("deviation")), "persist deviation reject");
}

{
  const now = 1_000;
  const a = new StaticProvider("a", new Map([["ZEC", { usd6: 50_000_000n, ts: now }]]));
  const b = new StaticProvider("b", new Map([["ZEC", { usd6: 50_050_000n, ts: now }]]));
  const outlier = new StaticProvider("outlier", new Map([["ZEC", { usd6: 80_000_000n, ts: now }]]));
  const out = await consensusUsd6([a, b, outlier], "ZEC", now, { token: "0xzec", minSources: 2 });
  assert(out.ok, `drop one outlier among 3: ${out.reason}`);
  assert(out.observations.some((o) => o.source === "outlier" && !o.ok), "outlier persisted as rejected");
}

{
  const now = 1_000;
  const a = new StaticProvider("a", new Map([["ZEC", { usd6: 50_000_000n, ts: now }]]));
  const out = await consensusUsd6([a], "ZEC", now, { token: "0xzec", arcUsd6: 10_000_000n, arcMaxDevBps: 400 });
  assert(!out.ok && out.reason === "arc sanity", out.reason);
}

{
  const asset: AssetPriceConfig = {
    token: "0xzec",
    symbol: "ZEC",
    important: true,
    sources: [{ name: "gone", kind: "http-json", url: "" }],
  };
  const out = await consensusForAsset(asset, 100, { env: { REACTOR_ENV: "PROD" } });
  assert(!out.ok && out.reason.includes("static forbidden"), out.reason);
}

{
  const hit = consumeIndexerValuation({ ok: true, usd6: "50000000" }, true);
  assert(hit !== "offline" && hit.ok && hit.usd6 === 50_000_000n, "accepted mark");
  const rejected = consumeIndexerValuation({ ok: false, usd6: "0", reason: "deviation" } as never, true);
  assert(rejected !== "offline" && !rejected.ok, "reachable fail is fail-closed");
  assert(consumeIndexerValuation(null, false) === "offline", "unreachable indexer is offline only");
}

{
  const now = 1_000;
  const nodes = new Map<string, QuoteNode>([
    ["0xusdc", { token: "0xusdc", symbol: "USDC", decimals: 6, usdPegOne: true }],
    [
      "0xzec",
      {
        token: "0xzec",
        symbol: "ZEC",
        decimals: 8,
        usdPegOne: false,
        externalUsd6: 0n,
        externalOk: false,
        externalStale: true,
      },
    ],
  ]);
  const svc = new ValuationService(nodes);
  const valued = svc.quoteUsd6("0xzec");
  const blocked = launchBlockedByValuation(valued);
  assert(blocked && blocked.includes("launch disabled"), blocked ?? "should block launch");

  const ranked = rankTop10([
    {
      token: "0xcat",
      symbol: "CAT",
      quote: "0xzec",
      graduated: true,
      isCore: false,
      markUsdc: 0n,
      markOk: false,
      priorRanked: true,
      lastGoodMarkUsdc: 400_000n * 1_000_000n,
    },
  ]);
  assert(ranked.pauseEpoch, "material Top-10 candidate pauses when quote mark fails closed");
}

console.log("pricing tests ok");
