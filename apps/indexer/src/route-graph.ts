import type { PublicClient } from "viem";
import { encodeAbiParameters } from "viem";
import type { Store } from "./db.ts";
import { priceQuoteX18FromSqrt } from "../../../packages/reactor/src/prices.ts";
import { approvedEdges, planRoute, planCandidates, scoreRoute, pickBest, normalizeVenueKind, type MarketEdge, type QuoteMeta, type PlannedRoute } from "../../../packages/reactor/src/routes.ts";

export function poolKeyBytes(a: `0x${string}`, b: `0x${string}`, fee: number, hooks: `0x${string}`): `0x${string}` {
  const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
    ],
    [{ currency0: c0, currency1: c1, fee, tickSpacing: 60, hooks }],
  );
}

export async function persistVenue(
  store: Store,
  v: {
    tokenIn: string;
    tokenOut: string;
    adapter: string;
    kind: string;
    data: string;
    poolId?: string;
    exists: boolean;
    approved: boolean;
    reliability?: number;
    lastPriceQuoteX18?: string;
  },
) {
  if (!v.exists || !v.approved) return;
  const id = `${v.kind}:${v.tokenIn.toLowerCase()}:${v.tokenOut.toLowerCase()}:${v.adapter.toLowerCase()}`;
  const mark = v.lastPriceQuoteX18 && v.lastPriceQuoteX18 !== "0" ? v.lastPriceQuoteX18 : "";
  await store.run(
    `INSERT INTO route_venues(id,token_in,token_out,adapter,kind,data,pool_id,exists_onchain,approved,reliability_bps,last_price_quote_x18)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       exists_onchain=excluded.exists_onchain,
       approved=excluded.approved,
       data=excluded.data,
       pool_id=CASE WHEN excluded.pool_id != '' THEN excluded.pool_id ELSE route_venues.pool_id END,
       last_price_quote_x18=CASE WHEN excluded.last_price_quote_x18 != '' THEN excluded.last_price_quote_x18 ELSE route_venues.last_price_quote_x18 END`,
    id,
    v.tokenIn.toLowerCase(),
    v.tokenOut.toLowerCase(),
    v.adapter.toLowerCase(),
    v.kind,
    v.data,
    v.poolId ?? "",
    v.exists ? 1 : 0,
    v.approved ? 1 : 0,
    v.reliability ?? 8_000,
    mark,
  );
}

/** Persist the executable mark on verified venues for this pool (PoolManager Swap / slot0). */
export async function updateVenueMarksFromSqrt(
  store: Store,
  poolId: string,
  sqrtPriceX96: string,
  quoteDec: Map<string, number>,
): Promise<void> {
  if (!poolId || !sqrtPriceX96 || sqrtPriceX96 === "0") return;
  let sqrt: bigint;
  try {
    sqrt = BigInt(sqrtPriceX96);
  } catch {
    return;
  }
  if (sqrt <= 0n) return;
  const venues = await store.all<{ id: string; token_in: string; token_out: string }>(
    `SELECT id, token_in, token_out FROM route_venues
     WHERE pool_id=? AND exists_onchain=1 AND approved=1`,
    poolId,
  );
  for (const v of venues) {
    const decIn = quoteDec.get(v.token_in.toLowerCase()) ?? 18;
    const decOut = quoteDec.get(v.token_out.toLowerCase()) ?? 18;
    const tokenIs0 = v.token_in.toLowerCase() < v.token_out.toLowerCase();
    let px = 0n;
    try {
      px = priceQuoteX18FromSqrt(sqrt, tokenIs0, decIn, decOut);
    } catch {
      continue;
    }
    if (px <= 0n) continue;
    await store.run("UPDATE route_venues SET last_price_quote_x18=? WHERE id=?", px.toString(), v.id);
  }
}

export async function loadEdges(store: Store, kind: "protocol" | "user" | "any"): Promise<MarketEdge[]> {
  const rows = await store.all<{
    token_in: string;
    token_out: string;
    adapter: string;
    kind: string;
    data: string;
    exists_onchain: number;
    approved: number;
  }>(
    kind === "any"
      ? "SELECT * FROM route_venues WHERE exists_onchain=1 AND approved=1"
      : "SELECT * FROM route_venues WHERE exists_onchain=1 AND approved=1 AND kind=?",
    ...(kind === "any" ? [] : [kind]),
  );
  return approvedEdges(
    rows.map((r) => ({
      from: r.token_in,
      to: r.token_out,
      adapter: r.adapter,
      kind: normalizeVenueKind(r.kind),
      data: r.data as `0x${string}`,
      usable: true,
      exists: true,
    })),
  );
}

export async function loadQuoteMetas(store: Store): Promise<Map<string, QuoteMeta>> {
  const rows = await store.all<{
    token: string;
    symbol: string;
    enabled: number;
    quarantined: number;
    usd_peg_one: number;
    hop_via_usdc: number;
    reactor_native: number;
  }>("SELECT * FROM quote_assets");
  const m = new Map<string, QuoteMeta>();
  for (const r of rows) {
    m.set(r.token.toLowerCase(), {
      token: r.token,
      symbol: r.symbol,
      enabled: r.enabled === 1,
      quarantined: r.quarantined === 1,
      usdPegOne: r.usd_peg_one === 1,
      hopViaUsdc: r.hop_via_usdc === 1,
      reactorNative: r.reactor_native === 1,
    });
  }
  return m;
}

/** Protocol / hookless RouteGraph only. Used by POST /quote maintenance kinds and the Keeper. */
export async function planFeeExemptRoute(
  store: Store,
  tokenIn: string,
  tokenOut: string,
  adapters: Set<string>,
): Promise<PlannedRoute> {
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    return { hops: [], path: [tokenIn.toLowerCase()], reason: "identity" };
  }
  const edges = await loadEdges(store, "any");
  const usable = edges.filter((e) => e.kind === "protocol" || e.kind === "hookless");
  const quotes = await loadQuoteMetas(store);
  return planRoute(tokenIn, tokenOut, usable, quotes, { protocol: true, adapters });
}

export async function syncOfficialFactoryVenues(
  store: Store,
  venues: Array<{ token: string; quote: string; protocol: string; user?: string; hook: string; poolId?: string }>,
) {
  for (const v of venues) {
    const data = poolKeyBytes(v.token as `0x${string}`, v.quote as `0x${string}`, 0, v.hook as `0x${string}`);
    await persistVenue(store, {
      tokenIn: v.quote,
      tokenOut: v.token,
      adapter: v.protocol,
      kind: "protocol",
      data,
      poolId: v.poolId,
      exists: true,
      approved: true,
    });
    await persistVenue(store, {
      tokenIn: v.token,
      tokenOut: v.quote,
      adapter: v.protocol,
      kind: "protocol",
      data,
      poolId: v.poolId,
      exists: true,
      approved: true,
    });
    if (v.user) {
      await persistVenue(store, {
        tokenIn: v.quote,
        tokenOut: v.token,
        adapter: v.user,
        kind: "user",
        data,
        poolId: v.poolId,
        exists: true,
        approved: true,
      });
      await persistVenue(store, {
        tokenIn: v.token,
        tokenOut: v.quote,
        adapter: v.user,
        kind: "user",
        data,
        poolId: v.poolId,
        exists: true,
        approved: true,
      });
    }
  }
}

export async function planAndScore(
  store: Store,
  tokenIn: string,
  tokenOut: string,
  protocol: boolean,
  adapters: Set<string>,
  sim: (route: PlannedRoute) => Promise<{ amountOut: bigint; impactBps: number }>,
) {
  const edges = await loadEdges(store, protocol ? "protocol" : "user");
  const hookless = await loadEdges(store, "any");
  const merged = [...edges, ...hookless.filter((e) => e.kind === "hookless")];
  const quotes = await loadQuoteMetas(store);
  const candidates = planCandidates(tokenIn, tokenOut, merged, quotes, { protocol, adapters, maxCandidates: 8 });
  const scored = [];
  for (const planned of candidates) {
    try {
      const simmed = await sim(planned);
      if (simmed.amountOut <= 1n) continue;
      scored.push(
        scoreRoute(planned, {
          amountOut: simmed.amountOut,
          impactBps: simmed.impactBps,
          gasEstimate: 80_000 + planned.hops.length * 90_000,
          reliabilityBps: Math.max(1_000, 9_500 - planned.hops.length * 400),
        }),
      );
    } catch {
      /* candidate unavailable */
    }
  }
  return pickBest(scored);
}

void (null as unknown as PublicClient);
