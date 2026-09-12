/**
 * Worker: populate external_price_marks from the configured provider registry.
 * Persists accepted and rejected observations plus the consensus row.
 * PROD: no static fallback. Fail closed when sources are missing or disagree.
 */
import type { Store } from "./db.ts";
import { isUniqueViolation } from "./unique.ts";
import {
  CONSENSUS_KIND,
  OBSERVATION_KIND,
  consensusForAsset,
  type PriceObservation,
  type PriceRegistry,
} from "../../../packages/reactor/src/pricing.ts";
import {
  assetsToPrice,
  loadPriceRegistry,
  loadQuoteAssetRows,
  loadVerifiedVenueUsd6,
} from "./price-registry.ts";
import deployment from "./deployment.json" with { type: "json" };

export async function populateExternalPriceMarks(
  store: Store,
  opts?: { registry?: PriceRegistry; now?: number; usdc?: string },
): Promise<PriceObservation[]> {
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  const registry = opts?.registry ?? loadPriceRegistry();
  const quotes = await loadQuoteAssetRows(store).catch(() => []);
  const assets = assetsToPrice(registry, quotes);
  const usdc = (opts?.usdc ?? (deployment.addresses as Record<string, string>).USDC ?? "").toLowerCase();
  const written: PriceObservation[] = [];
  for (const asset of assets) {
    const arcUsd6 = usdc ? await loadVerifiedVenueUsd6(store, asset.token, usdc) : undefined;
    const fused = await consensusForAsset(asset, now, { arcUsd6 });
    for (const obs of fused.observations) {
      await insertMark(store, obs);
      written.push(obs);
    }
  }
  return written;
}

async function insertMark(store: Store, obs: PriceObservation) {
  try {
    await store.run(
      "INSERT INTO external_price_marks(token,symbol,source,usd6,ts,ok,reason,kind) VALUES(?,?,?,?,?,?,?,?)",
      obs.token,
      obs.symbol,
      obs.source,
      obs.usd6.toString(),
      obs.ts,
      obs.ok ? 1 : 0,
      obs.reason,
      obs.kind === CONSENSUS_KIND ? CONSENSUS_KIND : OBSERVATION_KIND,
    );
  } catch (e) {
    if (isUniqueViolation(e)) return;
    throw e;
  }
}
