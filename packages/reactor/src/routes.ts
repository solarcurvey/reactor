/**
 * Canonical RoutePlanner — Keeper maintenance, user USDC buy/sell, launch/nested valuation.
 * Max 3 legs. Rejects cycles, duplicate assets, unsupported adapters, quarantined quotes, unusable markets.
 */

export const MAX_LEGS = 3;

export type AdapterKind = "protocol" | "user" | "hookless";

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
};

export type Hop = {
  adapter: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  minOut: bigint;
  data: `0x${string}`;
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
    if (!wantKind.includes(e.kind)) continue;
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
      const hops: Hop[] = cur.used.map((e, i) => ({
        adapter: e.adapter as `0x${string}`,
        tokenIn: e.from as `0x${string}`,
        tokenOut: e.to as `0x${string}`,
        minOut: opts.minOuts?.[i] ?? 0n,
        data: e.data,
      }));
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
  return {
    ...route,
    hops: route.hops.map((h, i) => ({ ...h, minOut: minOuts[i] ?? h.minOut })),
  };
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
