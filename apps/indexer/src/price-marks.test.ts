import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db.ts";
import { populateExternalPriceMarks } from "./price-marks.ts";
import { loadValuationService } from "./valuation-store.ts";
import { assetsToPrice, loadPriceRegistry, loadVerifiedVenueUsd6 } from "./price-registry.ts";
import { launchBlockedByValuation, CONSENSUS_KIND, type PriceRegistry } from "../../../packages/reactor/src/pricing.ts";
import { rankTop10 } from "../../../packages/reactor/src/top10.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "reactor-marks-"));
const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
const now = Math.floor(Date.now() / 1000);

await store.run(
  `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  "0xzec",
  "ZEC",
  "Zcash",
  8,
  0,
  1,
  0,
  0,
  0,
  "",
  0,
);
await store.run(
  `INSERT INTO quote_assets(token,symbol,name,decimals,category,enabled,usd_peg_one,hop_via_usdc,reactor_native,parent_quote,quarantined)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  "0xguardian",
  "EXT",
  "Guardian added",
  18,
  0,
  1,
  0,
  0,
  0,
  "",
  0,
);

{
  const registry = loadPriceRegistry({
    REACTOR_ENV: "LOCAL",
    PRICE_PROVIDERS_JSON: JSON.stringify({
      assets: [
        {
          token: "0xzec",
          symbol: "ZEC",
          important: true,
          minSources: 2,
          sources: [
            { name: "alpha", kind: "static", staticUsd6: "50000000" },
            { name: "beta", kind: "static", staticUsd6: "50100000" },
          ],
        },
      ],
    }),
  });
  assert(registry.assets.some((a) => a.token === "0xzec" && a.sources.length >= 2), "data-driven ZEC, not a hardcoded branch");
  const planned = assetsToPrice(registry, [
    { token: "0xzec", symbol: "ZEC", usd_peg_one: 0, enabled: 1 },
    { token: "0xguardian", symbol: "EXT", usd_peg_one: 0, enabled: 1 },
  ]);
  assert(planned.some((a) => a.token === "0xguardian" && a.sources.length === 0), "Guardian quote without providers is still scheduled");
}

{
  const registry: PriceRegistry = {
    assets: [
      {
        token: "0xzec",
        symbol: "ZEC",
        important: true,
        minSources: 2,
        sources: [
          { name: "alpha", kind: "static", staticUsd6: "50000000" },
          { name: "beta", kind: "static", staticUsd6: "50100000" },
        ],
      },
    ],
  };
  const written = await populateExternalPriceMarks(store, { registry, now, usdc: "0xusdc" });
  assert(written.some((o) => o.kind === CONSENSUS_KIND && o.ok), "accepted consensus persisted");
  assert(written.filter((o) => o.kind !== CONSENSUS_KIND && o.ok).length >= 2, "accepted observations persisted");
  const rows = await store.all<{ source: string; ok: number; kind: string }>("SELECT source, ok, kind FROM external_price_marks WHERE token='0xzec'");
  assert(rows.some((r) => r.kind === "consensus" && Number(r.ok) === 1), "consensus row in table");
  const svc = await loadValuationService(store);
  const v = svc.quoteUsd6("0xzec");
  assert(v.ok && v.usd6 === 50_100_000n, `ValuationService consumes accepted consensus, got ${v.usd6} ${v.reason}`);
  assert(launchBlockedByValuation(v) == null, "healthy mark may authorize");
}

{
  const registry: PriceRegistry = {
    assets: [
      {
        token: "0xzec",
        symbol: "ZEC",
        important: true,
        minSources: 2,
        sources: [
          { name: "alpha", kind: "static", staticUsd6: "50000000" },
          { name: "manip", kind: "static", staticUsd6: "80000000" },
        ],
      },
    ],
  };
  await populateExternalPriceMarks(store, { registry, now: now + 1, usdc: "0xusdc" });
  const rejected = await store.all<{ source: string; ok: number; reason: string; kind: string }>(
    "SELECT source, ok, reason, kind FROM external_price_marks WHERE token='0xzec' AND ts=?",
    now + 1,
  );
  assert(rejected.some((r) => r.kind === "consensus" && Number(r.ok) === 0 && r.reason.includes("deviation")), "rejected consensus persisted");
  assert(rejected.some((r) => Number(r.ok) === 0 && r.reason.includes("deviation")), "rejected observation reason persisted");
  const svc = await loadValuationService(store);
  const v = svc.quoteUsd6("0xzec");
  assert(!v.ok, `deviation must not price launches: ${v.reason}`);
  const blocked = launchBlockedByValuation(v);
  assert(blocked && blocked.includes("launch disabled"), blocked ?? "launch must fail closed");
  const ranked = rankTop10([
    {
      token: "0xcat",
      quote: "0xzec",
      graduated: true,
      isCore: false,
      markUsdc: 0n,
      markOk: false,
      priorRanked: true,
      lastGoodMarkUsdc: 400_000n * 1_000_000n,
    },
  ]);
  assert(ranked.pauseEpoch, "material Top-10 candidate pauses on quote outage/deviation");
}

{
  const prev = process.env.REACTOR_ENV;
  process.env.REACTOR_ENV = "PROD";
  try {
    const registry = loadPriceRegistry({
      REACTOR_ENV: "PROD",
      PRICE_PROVIDERS_JSON: JSON.stringify({
        assets: [
          {
            token: "0xzec",
            symbol: "ZEC",
            important: true,
            sources: [{ name: "local-static", kind: "static", staticUsd6: "50000000" }],
          },
        ],
      }),
    });
    const written = await populateExternalPriceMarks(store, { registry, now: now + 2, usdc: "0xusdc" });
    assert(
      written.some((o) => o.kind === CONSENSUS_KIND && !o.ok && o.reason.includes("static forbidden")),
      "PROD never silently uses static",
    );
  } finally {
    if (prev == null) delete process.env.REACTOR_ENV;
    else process.env.REACTOR_ENV = prev;
  }
}

{
  const registry: PriceRegistry = {
    assets: [{ token: "0xguardian", symbol: "EXT", sources: [] }],
  };
  const written = await populateExternalPriceMarks(store, { registry, now: now + 3, usdc: "0xusdc" });
  assert(
    written.some((o) => o.token === "0xguardian" && o.kind === CONSENSUS_KIND && !o.ok),
    "unconfigured Guardian quote fails closed",
  );
}

{
  await store.run(
    `INSERT INTO route_venues(id,token_in,token_out,adapter,kind,data,pool_id,exists_onchain,approved,reliability_bps)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    "zec-usdc",
    "0xzec",
    "0xusdc",
    "v4",
    "v4",
    "{}",
    "0xpool",
    1,
    1,
    10_000,
  );
  await store.run(
    `INSERT INTO markets(token,quote,price_quote_x18,updated_ts) VALUES(?,?,?,?)`,
    "0xzec",
    "0xusdc",
    (10n * 10n ** 18n).toString(),
    1,
  );
  const arc = await loadVerifiedVenueUsd6(store, "0xzec", "0xusdc");
  assert(arc === 10_000_000n, `arc venue usd6 ${arc}`);
}

await store.close();
rmSync(dir, { recursive: true, force: true });
console.log("price-marks tests ok");
