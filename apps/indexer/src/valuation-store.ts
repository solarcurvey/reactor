import { ValuationService, ACCEPTED_MARK_FRESH_SEC, type QuoteNode } from "../../../packages/reactor/src/valuation.ts";
import { CONSENSUS_KIND, CONSENSUS_SOURCE } from "../../../packages/reactor/src/pricing.ts";
import type { Store } from "./db.ts";

/** Latest consensus row per token. Individual observations never price ValuationService. */
const LATEST_CONSENSUS_SQL = `SELECT token, usd6, ok, ts FROM external_price_marks
     WHERE (kind = '${CONSENSUS_KIND}' OR source IN ('${CONSENSUS_SOURCE}','fused','fail','missing'))
       AND id IN (
         SELECT MAX(id) FROM external_price_marks
         WHERE kind = '${CONSENSUS_KIND}' OR source IN ('${CONSENSUS_SOURCE}','fused','fail','missing')
         GROUP BY token
       )`;

/** Canonical ValuationService from indexer tables + accepted consensus marks. */
export async function loadValuationService(store: Store): Promise<ValuationService> {
  const quotes = await store.all<{
    token: string;
    symbol: string;
    decimals: number;
    usd_peg_one: number;
    parent_quote: string;
    quarantined: number;
  }>("SELECT token,symbol,decimals,usd_peg_one,parent_quote,quarantined FROM quote_assets");
  const markets = await store.all<{ token: string; quote: string; price_quote_x18: string }>(
    "SELECT token,quote,price_quote_x18 FROM markets",
  );
  const marks = await store.all<{ token: string; usd6: string; ok: number; ts: number }>(LATEST_CONSENSUS_SQL);
  const nodes = new Map<string, QuoteNode>();
  for (const q of quotes) {
    nodes.set(q.token.toLowerCase(), {
      token: q.token,
      symbol: q.symbol,
      decimals: Number(q.decimals),
      usdPegOne: Number(q.usd_peg_one) === 1,
      quarantined: Number(q.quarantined) === 1,
      parentQuote: q.parent_quote || undefined,
    });
  }
  const now = Math.floor(Date.now() / 1000);
  for (const m of marks) {
    const key = m.token.toLowerCase();
    const prev = nodes.get(key) ?? { token: m.token, symbol: m.token.slice(0, 6), decimals: 18, usdPegOne: false };
    const fresh = Number(m.ok) === 1 && Number(m.ts) >= now - ACCEPTED_MARK_FRESH_SEC && BigInt(m.usd6 || "0") > 0n;
    nodes.set(key, {
      ...prev,
      externalUsd6: BigInt(m.usd6 || "0"),
      externalOk: fresh,
      externalStale: !fresh && BigInt(m.usd6 || "0") > 0n,
    });
  }
  for (const m of markets) {
    if (!m.quote || !m.price_quote_x18 || m.price_quote_x18 === "0") continue;
    const key = m.token.toLowerCase();
    const prev = nodes.get(key) ?? { token: m.token, symbol: m.token.slice(0, 6), decimals: 18, usdPegOne: false };
    nodes.set(key, { ...prev, parentQuote: m.quote.toLowerCase(), priceInParentX18: BigInt(m.price_quote_x18) });
  }
  const usdc = [...nodes.values()].find((n) => n.usdPegOne);
  if (!usdc) {
    nodes.set("usdc", { token: "usdc", symbol: "USDC", decimals: 6, usdPegOne: true });
  }
  return new ValuationService(nodes);
}
