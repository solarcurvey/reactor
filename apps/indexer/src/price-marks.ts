/**
 * Worker: populate external_price_marks from live HTTP sources.
 * PROD: no static ZEC. Fail closed if ZEC_HTTP_URL missing.
 */
import type { Store } from "./db.ts";
import { HttpJsonProvider, StaticProvider, consensusUsd6 } from "../../../packages/reactor/src/pricing.ts";
import { isUniqueViolation } from "./unique.ts";

export async function populateExternalPriceMarks(store: Store): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const prod = (process.env.REACTOR_ENV ?? "").toUpperCase() === "PROD";
  const symbols = [
    { symbol: "ZEC", token: process.env.ZEC_ADDRESS ?? "zec", url: process.env.ZEC_HTTP_URL },
    { symbol: "WBTC", token: process.env.WBTC_ADDRESS ?? "wbtc", url: process.env.WBTC_HTTP_URL },
  ];
  for (const s of symbols) {
    const providers = [];
    if (s.url) {
      providers.push(
        new HttpJsonProvider(`${s.symbol}-http`, () => s.url as string, (body) => {
          const n = Number((body as { usd6?: string; price?: number }).usd6 ?? (body as { price?: number }).price);
          if (!Number.isFinite(n) || n <= 0) return null;
          const usd6 = n < 1_000 ? BigInt(Math.round(n * 1_000_000)) : BigInt(Math.round(n));
          return { usd6, ts: now };
        }),
      );
    } else if (!prod && s.symbol === "ZEC") {
      providers.push(
        new StaticProvider("local-static", new Map([["ZEC", { usd6: BigInt(process.env.ZEC_USD6 ?? 50_000_000), ts: now }]])),
      );
    } else if (prod && s.symbol === "ZEC") {
      await insertMark(store, s.token, s.symbol, "missing", "0", now, 0, "ZEC_HTTP_URL required in prod");
      continue;
    }
    if (!providers.length) continue;
    const fused = await consensusUsd6(providers, s.symbol, now);
    await insertMark(store, s.token, s.symbol, fused.ok ? "fused" : "fail", fused.usd6.toString(), now, fused.ok ? 1 : 0, fused.reason ?? "");
  }
}

async function insertMark(
  store: Store,
  token: string,
  symbol: string,
  source: string,
  usd6: string,
  ts: number,
  ok: number,
  reason: string,
) {
  try {
    await store.run(
      "INSERT INTO external_price_marks(token,symbol,source,usd6,ts,ok,reason) VALUES(?,?,?,?,?,?,?)",
      token.toLowerCase(),
      symbol,
      source,
      usd6,
      ts,
      ok,
      reason,
    );
  } catch (e) {
    if (isUniqueViolation(e)) return;
    throw e;
  }
}
