/**
 * Data-driven external price provider registry.
 * Keyed by canonical quote token address (then symbol). Not ZEC/WBTC branches.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandEnvTemplate,
  isProdPricingEnv,
  mergePriceRegistries,
  normalizeTokenKey,
  resolveAssetConfig,
  type AssetPriceConfig,
  type PriceRegistry,
  type PriceSourceConfig,
} from "../../../packages/reactor/src/pricing.ts";
import { usd6FromPriceQuote } from "../../../packages/reactor/src/prices.ts";
import { USDC_ONE } from "../../../packages/reactor/src/valuation.ts";
import type { Store } from "./db.ts";

const DEFAULT_PATH = join(dirname(fileURLToPath(import.meta.url)), "../config/price-providers.json");

export function loadPriceRegistryFile(path: string, env: Record<string, string | undefined> = process.env): PriceRegistry {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(expandEnvTemplate(raw, env)) as PriceRegistry;
  return normalizeRegistry(parsed);
}

function normalizeRegistry(reg: PriceRegistry): PriceRegistry {
  return {
    assets: (reg.assets ?? []).map((a) => ({
      ...a,
      token: normalizeTokenKey(a.token || a.symbol),
      symbol: a.symbol.toUpperCase(),
      sources: (a.sources ?? []).map((s) => ({ ...s, url: s.url?.trim() || undefined })),
    })),
  };
}

function envUrlSources(symbol: string, env: Record<string, string | undefined>): PriceSourceConfig[] {
  const prefix = symbol.toUpperCase();
  const urls = [
    env[`${prefix}_HTTP_URL`],
    env[`${prefix}_HTTP_URL_2`],
    ...(env[`${prefix}_HTTP_URLS`] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ].filter((u, i, all): u is string => Boolean(u) && all.indexOf(u) === i);
  return urls.map((url, i) => ({
    name: `${symbol.toLowerCase()}-http-${i + 1}`,
    kind: "http-json" as const,
    parser: "price" as const,
    url,
  }));
}

function localStaticSource(symbol: string, env: Record<string, string | undefined>): PriceSourceConfig | undefined {
  if (isProdPricingEnv(env)) return undefined;
  const raw = env[`${symbol.toUpperCase()}_USD6`];
  if (!raw && symbol.toUpperCase() !== "ZEC") return undefined;
  return {
    name: "local-static",
    kind: "static",
    staticUsd6: raw ?? (symbol.toUpperCase() === "ZEC" ? "50000000" : undefined),
  };
}

/** Built-in ZEC/WBTC slots plus PRICE_PROVIDERS_JSON / PRICE_PROVIDERS_PATH. */
export function loadPriceRegistry(env: Record<string, string | undefined> = process.env): PriceRegistry {
  const parts: PriceRegistry[] = [];
  const filePath = env.PRICE_PROVIDERS_PATH || DEFAULT_PATH;
  if (existsSync(filePath)) {
    parts.push(loadPriceRegistryFile(filePath, env));
  }
  if (env.PRICE_PROVIDERS_JSON?.trim()) {
    const parsed = JSON.parse(expandEnvTemplate(env.PRICE_PROVIDERS_JSON, env)) as PriceRegistry;
    parts.push(normalizeRegistry(parsed));
  }
  const merged = mergePriceRegistries(...parts);
  for (const symbol of ["ZEC", "WBTC"] as const) {
    const token = normalizeTokenKey(env[`${symbol}_ADDRESS`] || symbol.toLowerCase());
    const extra = envUrlSources(symbol, env);
    const existing = resolveAssetConfig(merged, token) ?? resolveAssetConfig(merged, symbol);
    if (existing) {
      existing.token = existing.token && existing.token !== symbol.toLowerCase() ? existing.token : token;
      const names = new Set(existing.sources.map((s) => s.url || s.name));
      for (const s of extra) {
        if (s.url && !names.has(s.url) && !names.has(s.name)) existing.sources.push(s);
      }
    } else if (extra.length) {
      merged.assets.push({
        token,
        symbol,
        important: true,
        minSources: extra.length >= 2 ? 2 : isProdPricingEnv(env) ? 2 : 1,
        sources: extra,
      });
    }
  }
  if (!isProdPricingEnv(env)) {
    for (const asset of merged.assets) {
      const hasLiveHttp = asset.sources.some((s) => s.kind === "http-json" && s.url);
      if (hasLiveHttp) continue;
      const local = localStaticSource(asset.symbol, env);
      if (local && !asset.sources.some((s) => s.name === local.name)) asset.sources.push(local);
    }
  }
  return merged;
}

export type QuoteAssetRow = {
  token: string;
  symbol: string;
  usd_peg_one: number;
  enabled: number;
  quarantined?: number;
};

/**
 * Every enabled non-peg quote must have a registry entry (possibly empty → fail closed).
 * Guardian-added externals without providers are still priced as unconfigured.
 */
export function assetsToPrice(registry: PriceRegistry, quotes: QuoteAssetRow[]): AssetPriceConfig[] {
  const out: AssetPriceConfig[] = [];
  const seen = new Set<string>();
  const consider = (asset: AssetPriceConfig) => {
    const key = normalizeTokenKey(asset.token) || asset.symbol.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(asset);
  };
  for (const q of quotes) {
    if (Number(q.enabled) !== 1) continue;
    if (Number(q.usd_peg_one) === 1) continue;
    const found = resolveAssetConfig(registry, q.token) ?? resolveAssetConfig(registry, q.symbol);
    consider(
      found
        ? { ...found, token: normalizeTokenKey(q.token), symbol: q.symbol || found.symbol }
        : { token: normalizeTokenKey(q.token), symbol: q.symbol, sources: [] },
    );
  }
  for (const asset of registry.assets) consider(asset);
  return out;
}

export async function loadQuoteAssetRows(store: Store): Promise<QuoteAssetRow[]> {
  return store.all<QuoteAssetRow>(
    "SELECT token, symbol, usd_peg_one, enabled, quarantined FROM quote_assets",
  );
}

export async function loadVerifiedVenueUsd6(
  store: Store,
  token: string,
  usdcToken: string,
): Promise<bigint | undefined> {
  const t = token.toLowerCase();
  const u = usdcToken.toLowerCase();
  if (!t || !u || t === u) return undefined;
  const venue = await store.get<{ n: number }>(
    `SELECT COUNT(*) as n FROM route_venues
     WHERE exists_onchain=1 AND approved=1
       AND ((lower(token_in)=? AND lower(token_out)=?) OR (lower(token_in)=? AND lower(token_out)=?))`,
    t,
    u,
    u,
    t,
  );
  if (!venue || Number(venue.n) === 0) {
    const official = await store.get<{ n: number }>(
      `SELECT COUNT(*) as n FROM official_pools
       WHERE (lower(token)=? AND lower(quote)=?) OR (lower(token)=? AND lower(quote)=?)`,
      t,
      u,
      u,
      t,
    );
    if (!official || Number(official.n) === 0) return undefined;
  }
  const mkt = await store.get<{ price_quote_x18: string }>(
    `SELECT price_quote_x18 FROM markets
     WHERE lower(token)=? AND lower(quote)=? AND price_quote_x18 IS NOT NULL AND price_quote_x18 != '0'
     LIMIT 1`,
    t,
    u,
  );
  if (!mkt?.price_quote_x18) return undefined;
  const usd6 = usd6FromPriceQuote(BigInt(mkt.price_quote_x18), USDC_ONE);
  return usd6 > 0n ? usd6 : undefined;
}
