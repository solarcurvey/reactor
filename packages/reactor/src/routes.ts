/**
 * Canonical RoutePlanner — Keeper maintenance, user USDC buy/sell, launch/nested valuation.
 * Max 3 legs. Rejects cycles, duplicate assets, unsupported adapters, quarantined quotes, unusable markets.
 */

export const MAX_LEGS = 3;

export type AdapterKind = "protocol" | "user" | "hookless" | "OFFICIAL_REACTOR_V4" | "EXTERNAL_V4_HOOKLESS" | "BONDING_CURVE";

export const VENUE = {
  OFFICIAL_REACTOR_V4: "OFFICIAL_REACTOR_V4",
  EXTERNAL_V4_HOOKLESS: "EXTERNAL_V4_HOOKLESS",
  BONDING_CURVE: "BONDING_CURVE",
} as const;

export function normalizeVenueKind(kind: string): AdapterKind {
  if (kind === "OFFICIAL_REACTOR_V4" || kind === "protocol") return "protocol";
  if (kind === "EXTERNAL_V4_HOOKLESS" || kind === "hookless") return "hookless";
  if (kind === "BONDING_CURVE") return "BONDING_CURVE";
  if (kind === "user") return "user";
  return kind as AdapterKind;
}

/** Official REACTOR pool or Instant bonding — not hookless external v4. */
export function isOfficialReactorVenue(kind?: string): boolean {
  if (!kind) return false;
  const n = normalizeVenueKind(kind);
  return n === "protocol" || n === "user" || n === "BONDING_CURVE" || kind === VENUE.OFFICIAL_REACTOR_V4;
}

export function isHooklessVenue(kind?: string): boolean {
  if (!kind) return false;
  return normalizeVenueKind(kind) === "hookless" || kind === VENUE.EXTERNAL_V4_HOOKLESS;
}

/** Canonical hop `kind` on quote tickets. */
export function displayVenueKind(kind?: string): string {
  if (!kind) return VENUE.EXTERNAL_V4_HOOKLESS;
  if (kind === VENUE.BONDING_CURVE || normalizeVenueKind(kind) === "BONDING_CURVE") return VENUE.BONDING_CURVE;
  if (isOfficialReactorVenue(kind)) return VENUE.OFFICIAL_REACTOR_V4;
  return VENUE.EXTERNAL_V4_HOOKLESS;
}

export function hopFromEdge(e: MarketEdge, minOut = 0n): Hop {
  return {
    adapter: e.adapter as `0x${string}`,
    tokenIn: e.from as `0x${string}`,
    tokenOut: e.to as `0x${string}`,
    minOut,
    data: e.data,
    kind: e.kind,
  };
}

export type MarketEdge = {
  from: string;
  to: string;
  adapter: string;
  kind: AdapterKind;
  data: `0x${string}`;
  usable: boolean;
};

export type QuoteMeta = {
  token: string;
  symbol: string;
  quarantined?: boolean;
  enabled?: boolean;
  usdPegOne?: boolean;
  reactorNative?: boolean;
  hopViaUsdc?: boolean;
};

export type Hop = {
  adapter: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  minOut: bigint;
  data: `0x${string}`;
  /** Off-chain venue identity. Not part of the on-chain Hop ABI. */
  kind?: AdapterKind | string;
};

export type PlannedRoute = {
  hops: Hop[];
  path: string[];
  reason: string;
};

export class RouteReject extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteReject";
  }
}

function norm(a: string): string {
  return a.toLowerCase();
}

export function planRoute(
  tokenIn: string,
  tokenOut: string,
  edges: MarketEdge[],
  quotes: Map<string, QuoteMeta>,
  opts: { protocol: boolean; adapters: Set<string>; minOuts?: bigint[] },
): PlannedRoute {
  const src = norm(tokenIn);
  const dst = norm(tokenOut);
  if (src === dst) return { hops: [], path: [src], reason: "identity" };

  const qIn = quotes.get(src);
  const qOut = quotes.get(dst);
  if (qIn?.quarantined || qIn?.enabled === false) throw new RouteReject(`quarantined/unusable ${src}`);
  if (qOut?.quarantined || qOut?.enabled === false) throw new RouteReject(`quarantined/unusable ${dst}`);

  const wantKind: AdapterKind[] = opts.protocol ? ["protocol", "hookless"] : ["user", "hookless"];
  const adj = new Map<string, MarketEdge[]>();
  for (const e of edges) {
    if (!e.usable) continue;
    if (!opts.adapters.has(norm(e.adapter))) continue;
    const kind = normalizeVenueKind(e.kind);
    if (!wantKind.includes(kind === "BONDING_CURVE" ? "protocol" : kind)) continue;
    const f = norm(e.from);
    const t = norm(e.to);
    const qf = quotes.get(f);
    const qt = quotes.get(t);
    if (qf?.quarantined || qt?.quarantined) continue;
    const list = adj.get(f) ?? [];
    list.push(e);
    adj.set(f, list);
  }

  type Node = { at: string; path: string[]; used: MarketEdge[] };
  const queue: Node[] = [{ at: src, path: [src], used: [] }];
  const seen = new Set<string>([src]);

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.at === dst) {
      if (cur.used.length > MAX_LEGS) throw new RouteReject("too many legs");
      const hops: Hop[] = cur.used.map((e, i) => hopFromEdge(e, opts.minOuts?.[i] ?? 0n));
      return { hops, path: cur.path, reason: `ok ${cur.path.join("→")}` };
    }
    if (cur.used.length >= MAX_LEGS) continue;
    for (const e of adj.get(cur.at) ?? []) {
      const nxt = norm(e.to);
      if (cur.path.includes(nxt)) continue;
      const key = `${cur.path.join(",")}>${nxt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ at: nxt, path: [...cur.path, nxt], used: [...cur.used, e] });
    }
  }
  throw new RouteReject(`no route ${src} → ${dst}`);
}

export function applyMinOuts(route: PlannedRoute, minOuts: bigint[]): PlannedRoute {
  if (minOuts.length !== route.hops.length) throw new RouteReject("need one minOut per hop");
  if (minOuts.some((m) => m <= 1n)) throw new RouteReject("hop minOut must exceed dust");
  if (minOuts.length > 1 && minOuts.slice(0, -1).some((m) => m === minOuts[minOuts.length - 1])) {
    throw new RouteReject("intermediate minOut must not reuse last-leg");
  }
  return {
    ...route,
    hops: route.hops.map((h, i) => ({ ...h, minOut: minOuts[i]! })),
  };
}

/** Only proven pools become edges. Fabricated 0.30% quote/USDC hops are rejected. */
export function approvedEdges(
  pools: Array<MarketEdge & { exists?: boolean }>,
): MarketEdge[] {
  return pools.filter((p) => p.usable && p.exists !== false).map(({ exists: _e, ...e }) => e);
}

export function requireProvenPool(exists: boolean, label: string): void {
  if (!exists) throw new RouteReject(`nonexistent fabricated pool ${label}`);
}

export type ScoredRoute = PlannedRoute & {
  amountOut: bigint;
  impactBps: number;
  gasEstimate: number;
  reliabilityBps: number;
  score: number;
};

/** Higher is better. Never invent venues — caller supplies simulated outs. */
export function scoreRoute(
  route: PlannedRoute,
  opts: { amountOut: bigint; impactBps: number; gasEstimate: number; reliabilityBps: number },
): ScoredRoute {
  if (route.hops.length > MAX_LEGS) throw new RouteReject("too many legs");
  const score =
    Number(opts.amountOut > 10n ** 18n ? 10n ** 9n : opts.amountOut) -
    opts.impactBps * 100 -
    opts.gasEstimate / 1000 +
    opts.reliabilityBps;
  return { ...route, ...opts, score };
}

export function pickBest(routes: ScoredRoute[]): ScoredRoute {
  if (routes.length === 0) throw new RouteReject("no scored routes");
  return routes.reduce((a, b) => (b.score > a.score ? b : a));
}

/** All simple routes ≤ MAX_LEGS. Caller simulates each and pickBest. Never invents venues. */
export function planCandidates(
  tokenIn: string,
  tokenOut: string,
  edges: MarketEdge[],
  quotes: Map<string, QuoteMeta>,
  opts: { protocol: boolean; adapters: Set<string>; maxCandidates?: number },
): PlannedRoute[] {
  const src = norm(tokenIn);
  const dst = norm(tokenOut);
  if (src === dst) return [{ hops: [], path: [src], reason: "identity" }];
  const wantKind: AdapterKind[] = opts.protocol ? ["protocol", "hookless"] : ["user", "hookless"];
  const adj = new Map<string, MarketEdge[]>();
  for (const e of edges) {
    if (!e.usable) continue;
    if (!opts.adapters.has(norm(e.adapter))) continue;
    const kind = normalizeVenueKind(e.kind);
    if (!wantKind.includes(kind === "BONDING_CURVE" ? "protocol" : kind)) continue;
    const f = norm(e.from);
    const list = adj.get(f) ?? [];
    list.push(e);
    adj.set(f, list);
  }
  const found: PlannedRoute[] = [];
  type Node = { at: string; path: string[]; used: MarketEdge[] };
  const queue: Node[] = [{ at: src, path: [src], used: [] }];
  const seen = new Set<string>([src]);
  const cap = opts.maxCandidates ?? 8;
  while (queue.length && found.length < cap) {
    const cur = queue.shift()!;
    if (cur.at === dst) {
      found.push({
        hops: cur.used.map((e) => hopFromEdge(e)),
        path: cur.path,
        reason: `ok ${cur.path.join("→")}`,
      });
      continue;
    }
    if (cur.used.length >= MAX_LEGS) continue;
    for (const e of adj.get(cur.at) ?? []) {
      const nxt = norm(e.to);
      if (cur.path.includes(nxt)) continue;
      const key = `${cur.path.join(",")}>${nxt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ at: nxt, path: [...cur.path, nxt], used: [...cur.used, e] });
    }
  }
  if (found.length === 0) throw new RouteReject(`no route ${src} → ${dst}`);
  return found;
}

export function encodeHooklessPoolKey(a: `0x${string}`, b: `0x${string}`): {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
} {
  const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return {
    currency0: c0 as `0x${string}`,
    currency1: c1 as `0x${string}`,
    fee: 3000,
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000",
  };
}
