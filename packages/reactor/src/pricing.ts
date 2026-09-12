/**
 * External pricing adapters + configured provider registry.
 * Offchain only — no Solidity oracle.
 * Degraded consensus → do not sign launches / pause material Top-10. Trading continues.
 * PROD never silently falls back to a static mark.
 */

import {
  fuseExternalUsd6,
  type ExternalTick,
  type FuseOpts,
  type RejectedTick,
  DEFAULT_MAX_AGE_SEC,
  DEFAULT_MAX_DEV_BPS,
  DEFAULT_ARC_MAX_DEV_BPS,
} from "./valuation.ts";

export {
  DEFAULT_MAX_AGE_SEC,
  DEFAULT_MAX_DEV_BPS,
  DEFAULT_ARC_MAX_DEV_BPS,
  ACCEPTED_MARK_FRESH_SEC,
} from "./valuation.ts";

export const CONSENSUS_SOURCE = "consensus";
export const CONSENSUS_KIND = "consensus";
export const OBSERVATION_KIND = "observation";

export type PriceProvider = {
  name: string;
  fetchUsd6(symbol: string, now: number): Promise<ExternalTick | null>;
};

export type PriceObservation = {
  token: string;
  symbol: string;
  source: string;
  usd6: bigint;
  ts: number;
  ok: boolean;
  reason: string;
  kind: typeof CONSENSUS_KIND | typeof OBSERVATION_KIND;
};

export type Consensus = {
  usd6: bigint;
  ok: boolean;
  reason: string;
  degraded: boolean;
  n: number;
  sources: string[];
  accepted: ExternalTick[];
  rejected: RejectedTick[];
  observations: PriceObservation[];
};

export type HttpParser = "usd6" | "usd" | "price" | "coingecko" | "coinbase" | "kraken";

export type PriceSourceKind = "http-json" | "static";

export type PriceSourceConfig = {
  name: string;
  kind: PriceSourceKind;
  url?: string;
  parser?: HttpParser;
  /** CoinGecko id or Kraken pair key. */
  id?: string;
  staticUsd6?: string;
};

export type AssetPriceConfig = {
  /** Canonical token address (lowercase). */
  token: string;
  symbol: string;
  sources: PriceSourceConfig[];
  minSources?: number;
  maxAgeSec?: number;
  maxDevBps?: number;
  arcMaxDevBps?: number;
  /** PROD defaults minSources to 2 when unset. */
  important?: boolean;
};

export type PriceRegistry = {
  assets: AssetPriceConfig[];
};

export function isProdPricingEnv(env: { REACTOR_ENV?: string } = process.env): boolean {
  return (env.REACTOR_ENV ?? "").toUpperCase() === "PROD";
}

export class StaticProvider implements PriceProvider {
  constructor(
    public name: string,
    private marks: Map<string, { usd6: bigint; ts: number }>,
  ) {}
  async fetchUsd6(symbol: string, _now: number): Promise<ExternalTick | null> {
    const m = this.marks.get(symbol.toUpperCase());
    if (!m) return null;
    return { usd6: m.usd6, ts: m.ts, name: this.name };
  }
}

export class HttpJsonProvider implements PriceProvider {
  constructor(
    public name: string,
    private urlFor: (symbol: string) => string,
    private parse: (body: unknown) => { usd6: bigint; ts: number } | null,
  ) {}
  async fetchUsd6(symbol: string, _now: number): Promise<ExternalTick | null> {
    try {
      const res = await fetch(this.urlFor(symbol), { signal: AbortSignal.timeout(4_000) });
      if (!res.ok) return null;
      const parsed = this.parse(await res.json());
      if (!parsed || parsed.usd6 <= 0n) return null;
      return { ...parsed, name: this.name };
    } catch {
      return null;
    }
  }
}

function asPositiveNumber(raw: unknown): number | null {
  if (typeof raw === "bigint") {
    if (raw <= 0n) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function usdToUsd6(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

function pick(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Parse a provider HTTP body into USD-6. `usd` is dollars; `usd6` is already micro-USD. */
export function usd6FromHttpBody(body: unknown, parser: HttpParser = "price", id?: string): bigint | null {
  if (parser === "coingecko") {
    const key = id ?? Object.keys((body ?? {}) as object)[0];
    if (!key) return null;
    const n = asPositiveNumber(pick(body, [key, "usd"]));
    return n == null ? null : usdToUsd6(n);
  }
  if (parser === "coinbase") {
    const n = asPositiveNumber(pick(body, ["data", "amount"]));
    return n == null ? null : usdToUsd6(n);
  }
  if (parser === "kraken") {
    const result = pick(body, ["result"]);
    if (!result || typeof result !== "object") return null;
    const pair = id && id in (result as object) ? (result as Record<string, unknown>)[id] : Object.values(result as object)[0];
    const close = pick(pair, ["c", "0"]) ?? pick(pair, ["c"]) ?? pick(pair, ["p", "0"]);
    const raw = Array.isArray(close) ? close[0] : close;
    const n = asPositiveNumber(raw);
    return n == null ? null : usdToUsd6(n);
  }
  const rec = (body ?? {}) as { usd6?: unknown; usd?: unknown; price?: unknown; amount?: unknown };
  if (parser === "usd6") {
    const n = asPositiveNumber(rec.usd6 ?? rec.price ?? rec.amount);
    if (n == null) return null;
    return BigInt(Math.round(n));
  }
  if (parser === "usd") {
    const n = asPositiveNumber(rec.usd ?? rec.price ?? rec.amount ?? rec.usd6);
    return n == null ? null : usdToUsd6(n);
  }
  const raw = rec.usd6 ?? rec.usd ?? rec.price ?? rec.amount;
  const n = asPositiveNumber(raw);
  if (n == null) return null;
  // Legacy heuristic: small numbers are dollars; large numbers are already USD-6.
  // Prefer explicit `usd` / `usd6` parsers for new sources (WBTC dollars are > 1000).
  if (rec.usd6 != null && rec.price == null && rec.usd == null) return BigInt(Math.round(n));
  if (n < 1_000) return usdToUsd6(n);
  if (n >= 1_000_000) return BigInt(Math.round(n));
  return usdToUsd6(n);
}

export function httpParserForSource(source: PriceSourceConfig): (body: unknown, now: number) => { usd6: bigint; ts: number } | null {
  const parser = source.parser ?? "price";
  return (body, now) => {
    const usd6 = usd6FromHttpBody(body, parser, source.id);
    if (usd6 == null || usd6 <= 0n) return null;
    return { usd6, ts: now };
  };
}

export function expandEnvTemplate(value: string, env: Record<string, string | undefined> = process.env): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => env[key] ?? "");
}

export function normalizeTokenKey(token: string): string {
  return token.trim().toLowerCase();
}

export function resolveAssetConfig(
  registry: PriceRegistry,
  tokenOrSymbol: string,
): AssetPriceConfig | undefined {
  const key = normalizeTokenKey(tokenOrSymbol);
  const byToken = registry.assets.find((a) => normalizeTokenKey(a.token) === key);
  if (byToken) return byToken;
  return registry.assets.find((a) => a.symbol.toUpperCase() === tokenOrSymbol.toUpperCase());
}

export function effectiveMinSources(asset: AssetPriceConfig, prod: boolean): number {
  if (asset.minSources != null) return asset.minSources;
  if (prod && asset.important) return 2;
  return 1;
}

export function fuseOptsForAsset(asset: AssetPriceConfig, prod: boolean, arcUsd6?: bigint): FuseOpts {
  return {
    maxAgeSec: asset.maxAgeSec ?? DEFAULT_MAX_AGE_SEC,
    maxDevBps: asset.maxDevBps ?? DEFAULT_MAX_DEV_BPS,
    arcMaxDevBps: asset.arcMaxDevBps ?? DEFAULT_ARC_MAX_DEV_BPS,
    minSources: effectiveMinSources(asset, prod),
    arcUsd6,
  };
}

export function providersFromAsset(
  asset: AssetPriceConfig,
  now: number,
  env: { REACTOR_ENV?: string } = process.env,
): { providers: PriceProvider[]; skipped: PriceObservation[] } {
  const prod = isProdPricingEnv(env);
  const providers: PriceProvider[] = [];
  const skipped: PriceObservation[] = [];
  for (const src of asset.sources) {
    if (src.kind === "static") {
      if (prod) {
        skipped.push({
          token: normalizeTokenKey(asset.token),
          symbol: asset.symbol,
          source: src.name,
          usd6: 0n,
          ts: now,
          ok: false,
          reason: "static forbidden in prod",
          kind: OBSERVATION_KIND,
        });
        continue;
      }
      const usd6 = BigInt(src.staticUsd6 || "0");
      if (usd6 <= 0n) {
        skipped.push({
          token: normalizeTokenKey(asset.token),
          symbol: asset.symbol,
          source: src.name,
          usd6: 0n,
          ts: now,
          ok: false,
          reason: "static mark empty",
          kind: OBSERVATION_KIND,
        });
        continue;
      }
      providers.push(new StaticProvider(src.name, new Map([[asset.symbol.toUpperCase(), { usd6, ts: now }]])));
      continue;
    }
    const url = src.url?.trim() ?? "";
    if (!url) {
      skipped.push({
        token: normalizeTokenKey(asset.token),
        symbol: asset.symbol,
        source: src.name,
        usd6: 0n,
        ts: now,
        ok: false,
        reason: "url missing",
        kind: OBSERVATION_KIND,
      });
      continue;
    }
    const parse = httpParserForSource(src);
    providers.push(
      new HttpJsonProvider(src.name, () => url, (body) => parse(body, now)),
    );
  }
  return { providers, skipped };
}

function observation(
  token: string,
  symbol: string,
  source: string,
  usd6: bigint,
  ts: number,
  ok: boolean,
  reason: string,
  kind: PriceObservation["kind"] = OBSERVATION_KIND,
): PriceObservation {
  return { token: normalizeTokenKey(token), symbol, source, usd6, ts, ok, reason, kind };
}

export async function consensusUsd6(
  providers: PriceProvider[],
  symbol: string,
  now: number,
  opts?: FuseOpts & { token?: string; skipped?: PriceObservation[] },
): Promise<Consensus> {
  const token = opts?.token ?? symbol;
  const ticks: ExternalTick[] = [];
  const fetchRejected: PriceObservation[] = [...(opts?.skipped ?? [])];
  for (const p of providers) {
    const t = await p.fetchUsd6(symbol, now);
    if (t) ticks.push(t);
    else {
      fetchRejected.push(observation(token, symbol, p.name, 0n, now, false, "fetch failed"));
    }
  }
  const fused = fuseExternalUsd6(ticks, now, opts);
  const observations: PriceObservation[] = [...fetchRejected];
  for (const t of fused.accepted) {
    observations.push(observation(token, symbol, t.name, t.usd6, t.ts, true, "accepted"));
  }
  for (const t of fused.rejected) {
    observations.push(observation(token, symbol, t.name, t.usd6, t.ts, false, t.rejectReason));
  }
  observations.push(
    observation(token, symbol, CONSENSUS_SOURCE, fused.usd6, now, fused.ok, fused.reason, CONSENSUS_KIND),
  );
  return {
    usd6: fused.usd6,
    ok: fused.ok,
    reason: fused.reason,
    degraded: !fused.ok,
    n: fused.n,
    sources: ticks.map((t) => t.name),
    accepted: fused.accepted,
    rejected: fused.rejected,
    observations,
  };
}

export async function consensusForAsset(
  asset: AssetPriceConfig,
  now: number,
  opts?: { arcUsd6?: bigint; env?: { REACTOR_ENV?: string }; extraProviders?: PriceProvider[] },
): Promise<Consensus> {
  const env = opts?.env ?? process.env;
  const prod = isProdPricingEnv(env);
  const { providers, skipped } = providersFromAsset(asset, now, env);
  const all = [...providers, ...(opts?.extraProviders ?? [])];
  if (all.length === 0) {
    const reason = prod ? "no live sources — static forbidden in prod" : "no providers configured";
    const observations = [
      ...skipped,
      observation(asset.token, asset.symbol, CONSENSUS_SOURCE, 0n, now, false, reason, CONSENSUS_KIND),
    ];
    return {
      usd6: 0n,
      ok: false,
      reason,
      degraded: true,
      n: 0,
      sources: [],
      accepted: [],
      rejected: [],
      observations,
    };
  }
  return consensusUsd6(all, asset.symbol, now, {
    ...fuseOptsForAsset(asset, prod, opts?.arcUsd6),
    token: asset.token,
    skipped,
  });
}

/** Signer / admission: refuse a new launch when the canonical mark is unavailable. */
export function launchBlockedByValuation(valued: { ok: boolean; usd6: bigint; reason?: string }): string | null {
  if (!valued.ok || valued.usd6 === 0n) {
    return `cannot price quote — valuation unavailable, launch disabled${valued.reason ? ` (${valued.reason})` : ""}`;
  }
  return null;
}

/**
 * When the indexer ValuationService responds, consume that mark.
 * Do not fall through to a separate on-chain hop implementation.
 * Unreachable indexer (`offline`) is for LOCAL/offline tests only.
 */
export function consumeIndexerValuation(
  response: { ok?: boolean; usd6?: string } | null,
  reachable: boolean,
): { usd6: bigint; ok: boolean } | "offline" {
  if (!reachable || response == null) return "offline";
  if (response.ok && response.usd6) {
    try {
      const usd6 = BigInt(response.usd6);
      if (usd6 > 0n) return { usd6, ok: true };
    } catch {
      return { usd6: 0n, ok: false };
    }
  }
  return { usd6: 0n, ok: false };
}

export function mergePriceRegistries(...parts: PriceRegistry[]): PriceRegistry {
  const byKey = new Map<string, AssetPriceConfig>();
  for (const part of parts) {
    for (const asset of part.assets) {
      const tokenKey = normalizeTokenKey(asset.token);
      const key = tokenKey || asset.symbol.toUpperCase();
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...asset, token: tokenKey || asset.token, sources: [...asset.sources] });
        continue;
      }
      const names = new Set(prev.sources.map((s) => s.name));
      const sources = [...prev.sources];
      for (const s of asset.sources) {
        if (!names.has(s.name)) sources.push(s);
        else {
          const i = sources.findIndex((x) => x.name === s.name);
          if (i >= 0) sources[i] = s;
        }
      }
      byKey.set(key, { ...prev, ...asset, token: tokenKey || prev.token, sources });
    }
  }
  return { assets: [...byKey.values()] };
}
