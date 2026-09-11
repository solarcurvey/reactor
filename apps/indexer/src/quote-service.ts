import { encodeFunctionData, parseAbi, type PublicClient } from "viem";
import type { Store } from "./db.ts";
import { loadEdges, loadQuoteMetas, planFeeExemptRoute } from "./route-graph.ts";
import { planRoute, applyMinOuts, type Hop } from "../../../packages/reactor/src/routes.ts";
import {
  applySlippage,
  splitQuoteFee,
  QUOTE_TTL_SEC,
  REACTOR_FEE_BPS,
  HOLDER_FEE_BPS,
  FLYWHEEL_FEE_BPS,
  CORE_FEE_BPS,
  type QuoteKind,
  type QuoteRequest,
  type QuoteResponse,
  type FeeLeg,
  type QuoteHop,
} from "../../../packages/reactor/src/quote.ts";
import { requestId } from "./obs.ts";

const curveAbi = parseAbi([
  "function buy(address token, uint256 quoteIn, uint256 minOut) returns (uint256)",
  "function sell(address token, uint256 tokensIn, uint256 minOut) returns (uint256)",
]);
const routerAbi = parseAbi([
  "function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, bool zeroForOne, int256 amountSpecified, uint256 minOut, address recipient) returns (uint256)",
]);
const userAbi = parseAbi([
  "function buy(address token, uint256 amountIn, (address adapter,address tokenIn,address tokenOut,uint256 minOut,bytes data)[] hops, uint256 minOut, uint256 deadline) returns (uint256)",
  "function sell(address token, uint256 amountIn, (address adapter,address tokenIn,address tokenOut,uint256 minOut,bytes data)[] hops, uint256 minQuoteOut, uint256 minOut, uint256 deadline) returns (uint256)",
]);

export type QuoteCtx = {
  store: Store;
  client: PublicClient;
  addresses: Record<string, string>;
  quoteSimulator: `0x${string}`;
};

function officialKey(token: string, quote: string, hook: string) {
  const [c0, c1] = token.toLowerCase() < quote.toLowerCase() ? [token, quote] : [quote, token];
  return {
    currency0: c0 as `0x${string}`,
    currency1: c1 as `0x${string}`,
    fee: 0,
    tickSpacing: 60,
    hooks: hook as `0x${string}`,
  };
}

function hooklessKey(a: string, b: string) {
  const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return {
    currency0: c0 as `0x${string}`,
    currency1: c1 as `0x${string}`,
    fee: 3000,
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  };
}

async function simSwap(
  ctx: QuoteCtx,
  key: ReturnType<typeof officialKey>,
  tokenIn: string,
  amountIn: bigint,
  account: `0x${string}`,
): Promise<bigint> {
  const zf1 = tokenIn.toLowerCase() === key.currency0.toLowerCase();
  const sim = await ctx.client.simulateContract({
    address: ctx.addresses.ReactorRouter as `0x${string}`,
    abi: routerAbi,
    functionName: "swap",
    args: [key, zf1, -amountIn, 1n, account],
    account,
  });
  return sim.result as bigint;
}

function feeLeg(venue: string, tokenIn: string, tokenOut: string, notional: bigint, official: boolean): FeeLeg {
  const split = official ? splitQuoteFee(notional) : { holders: 0n, flywheel: 0n, core: 0n, fee: 0n };
  return {
    venue,
    tokenIn,
    tokenOut,
    protocolFeeBps: official ? REACTOR_FEE_BPS : 0,
    holdersBps: official ? HOLDER_FEE_BPS : 0,
    flywheelBps: official ? FLYWHEEL_FEE_BPS : 0,
    coreBps: official ? CORE_FEE_BPS : 0,
    notionalQuote: notional.toString(),
    holders: split.holders.toString(),
    flywheel: split.flywheel.toString(),
    core: split.core.toString(),
    reactorOfficial: official,
  };
}

export async function buildQuote(ctx: QuoteCtx, req: QuoteRequest, rid = requestId()): Promise<QuoteResponse> {
  const slip = req.slippageBps ?? 100;
  const amountIn = BigInt(req.amountIn);
  if (amountIn <= 0n) return fail(rid, req, "amountIn required");
  const account = (req.recipient as `0x${string}` | undefined) ?? ctx.quoteSimulator;
  const addrs = ctx.addresses;
  const usdc = (addrs.USDC ?? "").toLowerCase();
  const hook = addrs.ReactorHook;
  const curve = addrs.InstantCurve as `0x${string}` | undefined;
  const userRoute = addrs.UserRouteExecutor as `0x${string}` | undefined;
  const protocol = req.kind === "MAINTENANCE" || req.kind === "TOP10" || req.kind === "CORE";
  const feeExempt = protocol || req.kind === "SELFBURN";

  const market = req.token
    ? await ctx.store.get<{ stage: string; quote: string; token: string }>("SELECT token, quote, stage FROM markets WHERE lower(token)=lower(?)", req.token)
    : undefined;
  const bonding = market?.stage === "bonding" && !!curve;

  const hops: QuoteHop[] = [];
  const feeLegs: FeeLeg[] = [];
  let amountOut = 0n;
  let path: string[] = [req.tokenIn];
  let functionName = "swap";
  let to = addrs.ReactorRouter;
  let data = "0x";

  try {
    if (req.kind === "BUY" || req.kind === "SELL") {
      const payingUsdc =
        req.kind === "BUY"
          ? req.tokenIn.toLowerCase() === usdc && market && market.quote.toLowerCase() !== usdc
          : req.tokenOut.toLowerCase() === usdc && market && market.quote.toLowerCase() !== usdc;
      let plannedHops: Hop[] = [];
      if (payingUsdc && userRoute) {
        const edges = await loadEdges(ctx.store, "user");
        const metas = await loadQuoteMetas(ctx.store);
        const adapters = new Set([ (addrs.V4Adapter ?? addrs.UniswapV4Adapter ?? "").toLowerCase() ].filter(Boolean));
        const src = req.kind === "BUY" ? req.tokenIn : market!.quote;
        const dst = req.kind === "BUY" ? market!.quote : req.tokenOut;
        const planned = planRoute(src, dst, edges, metas, { protocol: false, adapters });
        plannedHops = planned.hops;
        path = planned.path;
      }

      let cursor = amountIn;
      if (req.kind === "SELL") {
        if (bonding && curve && req.token) {
          const sim = await ctx.client.simulateContract({
            address: curve,
            abi: curveAbi,
            functionName: "sell",
            args: [req.token as `0x${string}`, amountIn, 1n],
            account,
          });
          cursor = sim.result as bigint;
          feeLegs.push(feeLeg("InstantCurve", req.token, market!.quote, cursor, !feeExempt));
        } else if (req.token && market && hook) {
          cursor = await simSwap(ctx, officialKey(req.token, market.quote, hook), req.token, amountIn, account);
          feeLegs.push(feeLeg("official-v4", req.token, market.quote, cursor, !feeExempt));
        }
      }

      for (const h of plannedHops) {
        const key = hooklessKey(h.tokenIn, h.tokenOut);
        const out = await simSwap(ctx, key, h.tokenIn, cursor, account);
        if (out <= 1n) return fail(rid, req, "hop quote is dust");
        hops.push({
          ...h,
          minOut: 0n,
          amountIn: cursor.toString(),
          amountOut: out.toString(),
          impactBps: 0,
          gasEstimate: 90_000,
          reliabilityBps: 8_500,
          feeExempt: false,
        });
        cursor = out;
      }

      if (req.kind === "BUY") {
        const quoteIn = plannedHops.length ? cursor : amountIn;
        if (bonding && curve && req.token) {
          const sim = await ctx.client.simulateContract({
            address: curve,
            abi: curveAbi,
            functionName: "buy",
            args: [req.token as `0x${string}`, quoteIn, 1n],
            account,
          });
          amountOut = sim.result as bigint;
          feeLegs.push(feeLeg("InstantCurve", market!.quote, req.token, quoteIn, !feeExempt));
          functionName = "buy";
          to = payingUsdc && userRoute ? userRoute : curve;
        } else if (req.token && market && hook) {
          amountOut = await simSwap(ctx, officialKey(req.token, market.quote, hook), market.quote, quoteIn, account);
          feeLegs.push(feeLeg("official-v4", market.quote, req.token, quoteIn, !feeExempt));
          to = payingUsdc && userRoute ? userRoute : addrs.ReactorRouter;
          functionName = payingUsdc ? "buy" : "swap";
        }
      } else {
        amountOut = cursor;
        functionName = payingUsdc && userRoute ? "sell" : bonding ? "sell" : "swap";
        to = payingUsdc && userRoute ? userRoute : bonding && curve ? curve : addrs.ReactorRouter;
      }

      const slipBps = BigInt(Math.max(1, slip));
      const stamped = hops.length
        ? applyMinOuts(
            { hops, path, reason: "quote" },
            hops.map((h) => applySlippage(BigInt(h.amountOut), Number(slipBps))),
          )
        : { hops, path, reason: "quote" };
      for (let i = 0; i < hops.length; i++) hops[i] = { ...hops[i]!, minOut: stamped.hops[i]!.minOut };

      const minOut = applySlippage(amountOut, slip);
      const deadline = Math.floor(Date.now() / 1000) + QUOTE_TTL_SEC;
      if (payingUsdc && userRoute) {
        data = encodeFunctionData({
          abi: userAbi,
          functionName: req.kind === "BUY" ? "buy" : "sell",
          args:
            req.kind === "BUY"
              ? [req.token as `0x${string}`, amountIn, stamped.hops, minOut, BigInt(deadline)]
              : [req.token as `0x${string}`, amountIn, stamped.hops, applySlippage(BigInt(hops[0]?.amountIn ?? amountOut), slip), minOut, BigInt(deadline)],
        });
      } else if (bonding && curve && req.token) {
        data = encodeFunctionData({
          abi: curveAbi,
          functionName: req.kind === "BUY" ? "buy" : "sell",
          args: [req.token as `0x${string}`, amountIn, minOut],
        });
      } else if (req.token && market && hook) {
        const key = officialKey(req.token, market.quote, hook);
        const tokenIn = req.kind === "BUY" ? market.quote : req.token;
        data = encodeFunctionData({
          abi: routerAbi,
          functionName: "swap",
          args: [key, tokenIn.toLowerCase() === key.currency0.toLowerCase(), -amountIn, minOut, account],
        });
      }

      return {
        ok: true,
        requestId: rid,
        kind: req.kind,
        tokenIn: req.tokenIn,
        tokenOut: req.tokenOut,
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
        minOut: minOut.toString(),
        hops,
        feeLegs,
        reactorFeeCount: feeLegs.filter((f) => f.reactorOfficial).length,
        totalProtocolFeeBps: feeLegs.filter((f) => f.reactorOfficial).reduce((s, f) => s + f.protocolFeeBps, 0),
        impactBps: hops.reduce((s, h) => s + h.impactBps, 0),
        expiry: deadline,
        path: path.length > 1 ? path : [req.tokenIn, req.tokenOut],
        tx: { to, data, value: "0", functionName },
      };
    }

    if (
      req.kind === "MAINTENANCE" ||
      req.kind === "TOP10" ||
      req.kind === "SELFBURN" ||
      req.kind === "CORE"
    ) {
      return await buildMaintenanceQuote(ctx, req, rid, account, slip);
    }

    return fail(rid, req, `unsupported quote kind ${req.kind}`);
  } catch (e) {
    return fail(rid, req, e instanceof Error ? e.message : "quote failed");
  }
}

async function buildMaintenanceQuote(
  ctx: QuoteCtx,
  req: QuoteRequest,
  rid: string,
  account: `0x${string}`,
  slip: number,
): Promise<QuoteResponse> {
  const addrs = ctx.addresses;
  const hook = addrs.ReactorHook ?? "";
  const protocol = (addrs.ProtocolV4Adapter ?? addrs.V4Adapter ?? "").toLowerCase();
  const adapters = new Set([protocol, (addrs.V4Adapter ?? "").toLowerCase()].filter(Boolean));
  const planned = await planFeeExemptRoute(ctx.store, req.tokenIn, req.tokenOut, adapters);
  const hops: QuoteHop[] = [];
  let cursor = BigInt(req.amountIn);
  let simulated = planned.hops.length === 0;
  for (const h of planned.hops) {
    const official = h.adapter.toLowerCase() === protocol && !!hook;
    const key = official ? officialKey(h.tokenIn, h.tokenOut, hook) : hooklessKey(h.tokenIn, h.tokenOut);
    let out = 0n;
    try {
      out = await simSwap(ctx, key, h.tokenIn, cursor, account);
      simulated = true;
    } catch {
      out = 0n;
    }
    hops.push({
      ...h,
      minOut: 0n,
      amountIn: cursor.toString(),
      amountOut: out.toString(),
      impactBps: 0,
      gasEstimate: 90_000,
      reliabilityBps: 8_500,
      feeExempt: true,
    });
    if (out > 1n) cursor = out;
  }
  if (planned.hops.length && hops.every((h) => h.amountOut === "0")) simulated = false;
  if (hops.length) {
    const outs = hops.map((h) => BigInt(h.amountOut));
    if (outs.every((o) => o > 1n)) {
      const stamped = applyMinOuts({ hops, path: planned.path, reason: planned.reason }, outs.map((o) => applySlippage(o, slip)));
      for (let i = 0; i < hops.length; i++) hops[i] = { ...hops[i]!, minOut: stamped.hops[i]!.minOut };
    } else {
      for (const h of hops) h.minOut = 1n;
    }
  }
  const amountOut = hops.length ? BigInt(hops[hops.length - 1]!.amountOut) : BigInt(req.amountIn);
  const minOut = amountOut > 1n ? applySlippage(amountOut, slip) : 0n;
  const vault =
    req.kind === "CORE"
      ? addrs.BuybackVault
      : req.kind === "SELFBURN"
        ? addrs.SelfBurnVault
        : addrs.FlywheelVault;
  const functionName =
    req.kind === "MAINTENANCE"
      ? "settleQuote"
      : req.kind === "TOP10"
        ? "executeTop10Buyback"
        : req.kind === "CORE"
          ? "execute"
          : "execute";
  return {
    ok: true,
    reason: simulated ? planned.reason : `${planned.reason} — simulate before submit`,
    requestId: rid,
    kind: req.kind,
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn,
    amountOut: amountOut.toString(),
    minOut: minOut.toString(),
    hops,
    feeLegs: [],
    reactorFeeCount: 0,
    totalProtocolFeeBps: 0,
    impactBps: 0,
    expiry: Math.floor(Date.now() / 1000) + QUOTE_TTL_SEC,
    path: planned.path,
    tx: { to: vault ?? "", data: "0x", value: "0", functionName },
  };
}

function fail(rid: string, req: QuoteRequest, reason: string): QuoteResponse {
  return {
    ok: false,
    reason,
    requestId: rid,
    kind: req.kind as QuoteKind,
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn,
    amountOut: "0",
    minOut: "0",
    hops: [],
    feeLegs: [],
    reactorFeeCount: 0,
    totalProtocolFeeBps: 0,
    impactBps: 0,
    expiry: 0,
    path: [],
  };
}
