"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { addresses } from "./addresses";
import { factory, registry, token, erc20, buyback, core, curve } from "./contracts";
import { CATEGORY_LABELS } from "./addresses";
import { INDEXER_URL } from "./chain";
import { FIXTURE_REACTOR_EVENTS, FIXTURE_TOKENS, FIXTURE_XSS_SWAPS, REVIEW_FIXTURES } from "./review-fixtures";
import { sanitizeAddress, sanitizeLaunchFields } from "./untrusted-metadata";

function cleanLaunch(t: LaunchToken): LaunchToken {
  const cleaned = sanitizeLaunchFields(t);
  const token = (sanitizeAddress(cleaned.token) || sanitizeAddress(t.token) || "") as `0x${string}`;
  return {
    ...t,
    ...cleaned,
    token,
    symbol: cleaned.symbol || t.symbol,
  };
}

export type QuoteAsset = {
  token: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  category: number;
  categoryLabel: string;
  enabled: boolean;
  exists: boolean;
  usdPegOne?: boolean;
};

export type LaunchToken = {
  token: `0x${string}`;
  quote: `0x${string}`;
  creator: `0x${string}`;
  mode: number;
  poolId: `0x${string}`;
  marketLive: boolean;
  fairId: bigint;
  name: string;
  symbol: string;
  decimals: number;
  supply: bigint;
  currentSupply?: bigint;
  image: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  ticker?: string;
  quoteSymbol?: string;
  quoteDecimals?: number;
  lifetimeRewards?: bigint;
  pendingRewards?: bigint;
  rewardsMode?: boolean;
  bonding?: boolean;
  bondingBps?: number;
  realQuote?: bigint;
  gradTarget?: bigint;
  devBought?: bigint;
  ready?: boolean;
  curve?: `0x${string}`;
  priceQuoteX18?: string;
  fdvUsd6?: string;
  volume24hUsd6?: string;
};

async function readQuotes(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<QuoteAsset[]> {
  const count = await client.readContract({
    ...registry,
    functionName: "count",
  });
  const n = Number(count as bigint);
  const out: QuoteAsset[] = [];
  for (let i = 0; i < n; i++) {
    const addr = (await client.readContract({
      ...registry,
      functionName: "list",
      args: [BigInt(i)],
    })) as `0x${string}`;
    const asset = (await client.readContract({
      ...registry,
      functionName: "get",
      args: [addr],
    })) as {
      token: `0x${string}`;
      symbol: string;
      name: string;
      decimals: number;
      icon: string;
      category: number;
      enabled: boolean;
      exists: boolean;
      buybackRouteEnabled?: boolean;
      usdPegOne?: boolean;
    };
    if (!asset.enabled) continue;
    if (asset.buybackRouteEnabled === false) continue;
    out.push({
      ...asset,
      usdPegOne: Boolean(asset.usdPegOne) || asset.symbol === "USDC",
      categoryLabel: CATEGORY_LABELS[asset.category] ?? "Other",
    });
  }
  return out;
}

async function readTokens(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<LaunchToken[]> {
  const len = Number(
    (await client.readContract({
      ...factory,
      functionName: "allTokensLength",
    })) as bigint,
  );
  const tokens: LaunchToken[] = [];
  for (let i = 0; i < len; i++) {
    const addr = (await client.readContract({
      ...factory,
      functionName: "allTokens",
      args: [BigInt(i)],
    })) as `0x${string}`;
    const rawInfo = await client.readContract({
      ...factory,
      functionName: "tokenInfo",
      args: [addr],
    });
    const info = unwrapTokenInfo(rawInfo);
    const rawMeta = await client.readContract({
      ...factory,
      functionName: "metadata",
      args: [addr],
    });
    const meta = unwrapMeta(rawMeta);
    const [name, symbol, decimals, supply, lifetimeRewards] = (await Promise.all([
      client.readContract({ address: addr, abi: token.abi, functionName: "name" }),
      client.readContract({ address: addr, abi: token.abi, functionName: "symbol" }),
      client.readContract({ address: addr, abi: token.abi, functionName: "decimals" }),
      client.readContract({ address: addr, abi: token.abi, functionName: "totalSupply" }),
      client.readContract({ address: addr, abi: token.abi, functionName: "lifetimeRewards" }),
    ])) as [string, string, number, bigint, bigint];
    let quoteSymbol = "";
    let quoteDecimals = 18;
    try {
      quoteSymbol = (await client.readContract({
        address: info.quote,
        abi: erc20.abi,
        functionName: "symbol",
      })) as string;
      quoteDecimals = (await client.readContract({
        address: info.quote,
        abi: erc20.abi,
        functionName: "decimals",
      })) as number;
    } catch {
      /* empty */
    }
    let rewardsMode = true;
    let bonding = false;
    let bondingBps = 0;
    let realQuote = 0n;
    let gradTarget = 0n;
    let devBought = 0n;
    let ready = false;
    let curveAddr: `0x${string}` | undefined;
    try {
      rewardsMode = (await client.readContract({
        ...factory,
        functionName: "isRewards",
        args: [addr],
      })) as boolean;
      curveAddr = (await client.readContract({
        ...factory,
        functionName: "curve",
      })) as `0x${string}`;
      if (Number(info.mode) === 0 && !info.marketLive && curveAddr && curveAddr !== "0x0000000000000000000000000000000000000000") {
          bonding = true;
          bondingBps = Number(
            (await client.readContract({
              address: curveAddr,
              abi: curve.abi,
              functionName: "bondingPct",
              args: [addr],
            })) as bigint,
          );
          realQuote = (await client.readContract({
            address: curveAddr,
            abi: curve.abi,
            functionName: "realQuoteOf",
            args: [addr],
          })) as bigint;
          gradTarget = (await client.readContract({
            address: curveAddr,
            abi: curve.abi,
            functionName: "gradTargetOf",
            args: [addr],
          })) as bigint;
          devBought = (await client.readContract({
            address: curveAddr,
            abi: curve.abi,
            functionName: "devBoughtOf",
            args: [addr],
          })) as bigint;
          ready = (await client.readContract({
            address: curveAddr,
            abi: curve.abi,
            functionName: "readyOf",
            args: [addr],
          })) as boolean;
      }
    } catch {
      /* curve not bound on older deploys */
    }
    tokens.push({
      token: addr,
      quote: info.quote,
      creator: info.creator,
      mode: Number(info.mode),
      poolId: info.poolId,
      marketLive: info.marketLive,
      fairId: info.fairId,
      name,
      symbol,
      decimals: Number(decimals),
      supply,
      image: meta.image,
      description: meta.description,
      website: meta.website,
      twitter: meta.twitter,
      telegram: meta.telegram,
      quoteSymbol,
      quoteDecimals: Number(quoteDecimals),
      lifetimeRewards,
      rewardsMode,
      bonding,
      bondingBps,
      realQuote,
      gradTarget,
      devBought,
      ready,
      curve: curveAddr,
    });
  }
  const out = tokens.reverse().map(cleanLaunch).filter((t) => sanitizeAddress(t.token));
  if (out.length === 0) return FIXTURE_TOKENS.map(cleanLaunch);
  return out;
}

function field(raw: unknown, name: string, index: number) {
  if (Array.isArray(raw)) return raw[index];
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rec, name) && rec[name] !== undefined) return rec[name];
    if (rec[index] !== undefined) return rec[index];
    if (rec[String(index)] !== undefined) return rec[String(index)];
  }
  return undefined;
}

function unwrapTokenInfo(raw: unknown) {
  return {
    token: field(raw, "token", 0) as `0x${string}`,
    quote: field(raw, "quote", 1) as `0x${string}`,
    creator: field(raw, "creator", 2) as `0x${string}`,
    mode: Number(field(raw, "mode", 3) ?? 0),
    poolId: field(raw, "poolId", 4) as `0x${string}`,
    marketLive: Boolean(field(raw, "marketLive", 5)),
    fairId: BigInt(field(raw, "fairId", 6) as bigint | number | string | undefined ?? 0),
  };
}

function unwrapMeta(raw: unknown) {
  return {
    image: String(field(raw, "image", 0) ?? ""),
    description: String(field(raw, "description", 1) ?? ""),
    website: String(field(raw, "website", 2) ?? ""),
    twitter: String(field(raw, "twitter", 3) ?? ""),
    telegram: String(field(raw, "telegram", 4) ?? ""),
  };
}

export function unwrapFair(raw: unknown) {
  return {
    token: field(raw, "token", 0) as `0x${string}`,
    quote: field(raw, "quote", 1) as `0x${string}`,
    creator: field(raw, "creator", 2) as `0x${string}`,
    startTime: BigInt(field(raw, "startTime", 3) as bigint | number | string ?? 0),
    endTime: BigInt(field(raw, "endTime", 4) as bigint | number | string ?? 0),
    auctionBps: Number(field(raw, "auctionBps", 5) ?? 0),
    minRaise: BigInt(field(raw, "minRaise", 6) as bigint | number | string ?? 0),
    totalBids: BigInt(field(raw, "totalBids", 7) as bigint | number | string ?? 0),
    auctionTokens: BigInt(field(raw, "auctionTokens", 8) as bigint | number | string ?? 0),
    lpTokens: BigInt(field(raw, "lpTokens", 9) as bigint | number | string ?? 0),
    finalized: Boolean(field(raw, "finalized", 10)),
    migrated: Boolean(field(raw, "migrated", 11)),
    poolId: field(raw, "poolId", 12) as `0x${string}`,
  };
}

export function useQuotes() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["quotes"],
    enabled: !!client || REVIEW_FIXTURES,
    queryFn: async () => {
      try {
        if (!client) throw new Error("no client");
        return await readQuotes(client);
      } catch (e) {
        if (REVIEW_FIXTURES) {
          return [
            { token: "0x4826533B4897376654Bb4d4AD88B7faFD0C98528" as `0x${string}`, symbol: "USDC", name: "USD Coin", decimals: 6, icon: "", category: 4, categoryLabel: "Stablecoins", enabled: true, exists: true },
            { token: "0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf" as `0x${string}`, symbol: "ZEC", name: "Mock ZEC", decimals: 8, icon: "", category: 0, categoryLabel: "Crypto", enabled: true, exists: true },
            { token: "0x0E801D84Fa97b50751Dbf25036d067dCf18858bF" as `0x${string}`, symbol: "BTC", name: "Mock BTC", decimals: 8, icon: "", category: 0, categoryLabel: "Crypto", enabled: true, exists: true },
          ];
        }
        throw e;
      }
    },
    refetchInterval: 15_000,
  });
}

function marketRowToLaunch(m: Record<string, unknown>): LaunchToken {
  return cleanLaunch({
    token: String(m.token ?? m.address) as `0x${string}`,
    quote: String(m.quote ?? "0x") as `0x${string}`,
    creator: String(m.creator ?? "0x") as `0x${string}`,
    mode: Number(m.mode ?? 0),
    poolId: String(m.pool_id ?? m.poolId ?? "0x") as `0x${string}`,
    marketLive: Boolean(m.market_live ?? m.marketLive),
    fairId: BigInt(String(m.fair_id ?? m.fairId ?? 0)),
    name: String(m.name ?? "Token"),
    symbol: String(m.symbol ?? "TKN"),
    decimals: Number(m.decimals ?? 18),
    supply: BigInt(String(m.current_supply || m.supply || "0")),
    currentSupply: BigInt(String(m.current_supply || m.supply || "0")),
    image: String(m.image ?? ""),
    description: String(m.description ?? ""),
    website: "",
    twitter: "",
    telegram: "",
    ticker: String(m.ticker ?? m.symbol ?? ""),
    quoteSymbol: String(m.quote_symbol ?? m.quoteSymbol ?? ""),
    quoteDecimals: Number(m.quote_decimals ?? m.quoteDecimals ?? 18),
    lifetimeRewards: BigInt(String(m.lifetime_rewards || "0")),
    rewardsMode: Number(m.rewards_mode ?? 1) !== 0,
    bonding: String(m.stage) === "bonding",
    bondingBps: Number(m.bonding_bps ?? 0),
    realQuote: BigInt(String(m.real_quote || "0")),
    gradTarget: BigInt(String(m.grad_target || "0")),
    ready: String(m.stage) === "ready",
    curve: undefined,
    priceQuoteX18: String(m.price_quote_x18 ?? "0"),
    fdvUsd6: String(m.fdv_usd6 ?? "0"),
    volume24hUsd6: String(m.volume_24h_usd6 ?? "0"),
  });
}

export function useLaunchTokens() {
  return useQuery({
    queryKey: ["launches"],
    queryFn: async () => {
      const res = await fetch(`${INDEXER_URL}/markets?limit=80`).catch(() => null);
      if (res?.ok) {
        const body = (await res.json()) as { items?: Record<string, unknown>[] };
        const items = (body.items ?? []).map(marketRowToLaunch).filter((t) => sanitizeAddress(t.token));
        if (REVIEW_FIXTURES) {
          const fixturesByAddr = new Map(FIXTURE_TOKENS.map((t) => [t.token.toLowerCase(), t]));
          const merged = items.map((t) => {
            const f = fixturesByAddr.get(t.token.toLowerCase());
            if (!f) return t;
            const emptyPx = !t.priceQuoteX18 || t.priceQuoteX18 === "0";
            const emptyVol = !t.volume24hUsd6 || t.volume24hUsd6 === "0";
            const emptyFdv = !t.fdvUsd6 || t.fdvUsd6 === "0";
            const emptyRewards = !t.lifetimeRewards || t.lifetimeRewards === 0n;
            return cleanLaunch({
              ...t,
              name: t.name && t.name !== "Token" ? t.name : f.name,
              symbol: t.symbol && t.symbol !== "TKN" ? t.symbol : f.symbol,
              quoteSymbol: t.quoteSymbol || f.quoteSymbol,
              quoteDecimals: t.quoteDecimals || f.quoteDecimals,
              image: t.image || f.image,
              description: t.description || f.description,
              website: t.website || f.website,
              twitter: t.twitter || f.twitter,
              telegram: t.telegram || f.telegram,
              priceQuoteX18: emptyPx ? f.priceQuoteX18 : t.priceQuoteX18,
              fdvUsd6: emptyFdv ? f.fdvUsd6 : t.fdvUsd6,
              volume24hUsd6: emptyVol ? f.volume24hUsd6 : t.volume24hUsd6,
              lifetimeRewards: emptyRewards ? f.lifetimeRewards : t.lifetimeRewards,
              bonding: t.bonding || f.bonding,
              bondingBps: t.bondingBps || f.bondingBps,
            });
          });
          const seen = new Set(merged.map((t) => t.token.toLowerCase()));
          return [...merged, ...FIXTURE_TOKENS.filter((t) => !seen.has(t.token.toLowerCase())).map(cleanLaunch)];
        }
        if (items.length) return items;
      }
      if (REVIEW_FIXTURES) return FIXTURE_TOKENS.map(cleanLaunch);
      return [] as LaunchToken[];
    },
    refetchInterval: 8_000,
  });
}

export function useCoreStats() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["core-stats"],
    enabled: !!client,
    queryFn: async () => {
      const [supply, accruedUsdc, lifetimeAccrued, lifetimeBurned, threshold, purchased] = await Promise.all([
        client!.readContract({ ...core, functionName: "totalSupply" }) as Promise<bigint>,
        client!.readContract({
          ...buyback,
          functionName: "accrued",
          args: [addresses.USDC],
        }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "lifetimeAccrued" }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "lifetimeBurned" }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "threshold" }) as Promise<bigint>,
        client!.readContract({ ...buyback, functionName: "lifetimePurchased" }) as Promise<bigint>,
      ]);
      // Real burn() shrinks totalSupply. BuybackVault.lifetimeBurned is the Keeper path.
      return { supply, burnedBal: lifetimeBurned, accruedUsdc, lifetimeAccrued, lifetimeBurned, threshold, purchased };
    },
    refetchInterval: 8_000,
  });
}

export function useIndexerHealth() {
  return useQuery({
    queryKey: ["indexer"],
    queryFn: async () => {
      const res = await fetch(`${INDEXER_URL}/health`).catch(() => null);
      if (!res?.ok) return { ok: false };
      return (await res.json()) as { ok: boolean; block?: number };
    },
    refetchInterval: 10_000,
  });
}

export type CandlePoint = { t: number; o: string; h: string; l: string; c: string; v: string; n: number };

function fixtureCandles(intervalSec: number): CandlePoint[] {
  const now = Math.floor(Date.now() / 1000);
  const start = now - intervalSec * 16;
  const out: CandlePoint[] = [];
  let px = 2n * 10n ** 16n;
  for (let i = 0; i < 16; i++) {
    const t = start + i * intervalSec;
    px += BigInt(i) * 10n ** 13n;
    const s = px.toString();
    out.push({ t, o: s, h: s, l: s, c: s, v: i % 3 === 0 ? "0" : "100000000", n: i % 3 === 0 ? 0 : 1 });
  }
  return out;
}

export function useCandles(token?: string, interval: string = "5m") {
  return useQuery({
    queryKey: ["candles", token, interval],
    enabled: !!token,
    queryFn: async () => {
      const empty = { candles: [] as CandlePoint[], sparse: true, interval };
      const res = await fetch(`${INDEXER_URL}/candles/${token}?interval=${encodeURIComponent(interval)}`).catch(() => null);
      if (!res?.ok) {
        if (!REVIEW_FIXTURES) return empty;
        const candles = fixtureCandles(
          interval === "1m" ? 60 : interval === "15m" ? 900 : interval === "1h" ? 3600 : interval === "4h" ? 14400 : interval === "1d" ? 86400 : 300,
        );
        return { candles, sparse: candles.filter((c) => c.n > 0).length < 3, interval };
      }
      const body = (await res.json()) as { candles?: CandlePoint[]; interval?: string };
      const candles = body.candles ?? [];
      const real = candles.filter((c) => c.n > 0).length;
      if (REVIEW_FIXTURES && candles.length === 0) {
        const fb = fixtureCandles(300);
        return { candles: fb, sparse: true, interval };
      }
      return { candles, sparse: real === 0 || real < 3, interval: body.interval ?? interval };
    },
    refetchInterval: 8_000,
  });
}

export function useSwapSeries(token?: string) {
  return useQuery({
    queryKey: ["swaps", token],
    enabled: !!token,
    queryFn: async () => {
      const empty: {
        t: number;
        ts?: number;
        notional: string;
        holders: string;
        buyback: string;
        flywheel?: string;
        coreAmt?: string;
        sqrtPrice?: string;
        px?: string;
        source?: string;
      }[] = [];
      const fixtures: typeof empty = [
        { t: 1, notional: "1000000000", holders: "20000000", buyback: "15000000", flywheel: "10000000", coreAmt: "5000000", sqrtPrice: "79228162514264337593543950336" },
        { t: 2, notional: "2000000000", holders: "40000000", buyback: "30000000", flywheel: "20000000", coreAmt: "10000000", sqrtPrice: "85000000000000000000000000000" },
        { t: 3, notional: "800000000", holders: "16000000", buyback: "12000000", flywheel: "8000000", coreAmt: "4000000", sqrtPrice: "91000000000000000000000000000" },
        ...FIXTURE_XSS_SWAPS,
      ];
      const res = await fetch(`${INDEXER_URL}/swaps/${token}`).catch(() => null);
      if (!res?.ok) return REVIEW_FIXTURES ? fixtures : empty;
      const rows = (await res.json()) as typeof empty;
      if (REVIEW_FIXTURES && rows.length === 0) return fixtures;
      return REVIEW_FIXTURES ? [...rows, ...FIXTURE_XSS_SWAPS] : rows;
    },
    refetchInterval: 8_000,
  });
}

export function useReactorEvents() {
  return useQuery({
    queryKey: ["reactor-events"],
    queryFn: async () => {
      const res = await fetch(`${INDEXER_URL}/reactor`).catch(() => null);
      const empty = { events: [] as { name: string; token: string; payload: string; block: number; tx: string }[] };
      if (!res?.ok) return REVIEW_FIXTURES ? { events: FIXTURE_REACTOR_EVENTS } : empty;
      const body = (await res.json()) as { events: { name: string; token: string; payload: string; block: number; tx: string }[] };
      if (REVIEW_FIXTURES) return { events: [...FIXTURE_REACTOR_EVENTS, ...(body.events ?? [])] };
      return body;
    },
    refetchInterval: 8_000,
  });
}

export function useTokenByAddress(address?: string) {
  const { data, ...rest } = useLaunchTokens();
  const token_ = useMemo(() => {
    const found = data?.find((t) => t.token.toLowerCase() === address?.toLowerCase());
    if (found) return found;
    if (REVIEW_FIXTURES) {
      const fixture = FIXTURE_TOKENS.find((t) => t.token.toLowerCase() === address?.toLowerCase());
      return fixture ? cleanLaunch(fixture) : undefined;
    }
    return found;
  }, [data, address]);
  return { data: token_, ...rest };
}
