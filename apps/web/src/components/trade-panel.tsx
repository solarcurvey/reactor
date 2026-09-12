"use client";

import { useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { erc20, router, token as tokenC, curve, userRoute } from "@/lib/contracts";
import { officialPoolKey, buyZeroForOne } from "@/lib/pool";
import { formatUnitsSafe, parseUnitsSafe } from "@/lib/utils";
import { useQuotes, type LaunchToken } from "@/lib/hooks";
import { addresses } from "@/lib/addresses";
import { INDEXER_URL } from "@/lib/chain";
import {
  buildQuoteDenomCatalog,
  formatOfficialFeeDisclosure,
  protocolQuoteFallbacks,
  type TicketFeeLeg,
} from "@/lib/fee-legs";
import { TxGuardError, resolveTradeWrite, sanitizeRouteHops } from "@/lib/tx-guard";
import { useOfficialChain } from "@/lib/use-official-chain";
import { UntrustedText } from "./untrusted-text";

const QUOTE_TTL_MS = 30_000;

export function TradePanel({ t }: { t: LaunchToken }) {
  const { address, isConnected, writesEnabled, matched, mismatchMessage, chainId } = useOfficialChain();
  const client = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [payUsdc, setPayUsdc] = useState(false);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [quotedOut, setQuotedOut] = useState<bigint | null>(null);
  const [quotedAt, setQuotedAt] = useState<number>(0);
  const [minQuoteOut, setMinQuoteOut] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [liveHops, setLiveHops] = useState<
    { adapter: `0x${string}`; tokenIn: `0x${string}`; tokenOut: `0x${string}`; minOut: bigint; data: `0x${string}` }[]
  >([]);
  const [feeLegs, setFeeLegs] = useState<TicketFeeLeg[]>([]);
  const [aggregateImpactBps, setAggregateImpactBps] = useState(0);
  const [reactorFeeCount, setReactorFeeCount] = useState(0);
  const { data: quotes } = useQuotes();

  const quoteDec = t.quoteDecimals ?? 18;
  const usdcRoute = Boolean(payUsdc && t.quote.toLowerCase() !== addresses.USDC.toLowerCase() && userRoute.address);
  const inDec = side === "buy" ? (usdcRoute ? 6 : quoteDec) : t.decimals;
  const parsed = parseUnitsSafe(amount, inDec);

  const feeView = formatOfficialFeeDisclosure(
    feeLegs,
    buildQuoteDenomCatalog({
      quotes: quotes ?? [],
      terminal: { token: t.quote, symbol: t.quoteSymbol, decimals: quoteDec },
      extras: protocolQuoteFallbacks(),
    }),
    { side, reactorFeeCount, aggregateImpactBps },
  );

  async function refreshQuote() {
    setError(null);
    if (!address || !client || parsed === 0n) {
      setQuotedOut(null);
      setMinQuoteOut(null);
      setFeeLegs([]);
      setAggregateImpactBps(0);
      setReactorFeeCount(0);
      return;
    }
    try {
      const res = await fetch(`${INDEXER_URL}/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: side === "buy" ? "BUY" : "SELL",
          token: t.token,
          tokenIn: side === "buy" ? (usdcRoute ? addresses.USDC : t.quote) : t.token,
          tokenOut: side === "buy" ? t.token : usdcRoute ? addresses.USDC : t.quote,
          amountIn: parsed.toString(),
          slippageBps: Math.max(1, Math.floor(Number(slippage || "1") * 100)),
          recipient: address,
        }),
      });
      const q = (await res.json()) as {
        ok?: boolean;
        reason?: string;
        amountOut?: string;
        minOut?: string;
        minQuoteOut?: string;
        hops?: typeof liveHops;
        feeLegs?: TicketFeeLeg[];
        aggregateProtocolImpactBps?: number;
        reactorFeeCount?: number;
        tx?: { to: string; data: `0x${string}`; functionName: string };
      };
      if (!res.ok || !q.ok || !q.amountOut) {
        throw new Error(q.reason ?? "Quote API unavailable");
      }
      setQuotedOut(BigInt(q.amountOut));
      setQuotedAt(Date.now());
      setLiveHops(q.hops ? sanitizeRouteHops(q.hops) : []);
      setFeeLegs(q.feeLegs ?? []);
      setAggregateImpactBps(q.aggregateProtocolImpactBps ?? 0);
      setReactorFeeCount(q.reactorFeeCount ?? q.feeLegs?.filter((f) => f.reactorOfficial && !f.feeExempt).length ?? 0);
      void q.tx;
      // First-leg floor is quote units from the atomic preview — never tokenIn / minOut.
      if (q.minQuoteOut) setMinQuoteOut(BigInt(q.minQuoteOut));
      else if (side === "sell" && q.minOut) setMinQuoteOut(BigInt(q.minOut));
      else setMinQuoteOut(null);
    } catch (e) {
      setQuotedOut(null);
      setError(e instanceof Error ? e.message : "Quote failed. Size may be larger than remaining depth.");
    }
  }

  async function submit() {
    setError(null);
    setHash(null);
    if (!address || !client) {
      setError("Connect a wallet on the local Arc-compatible chain.");
      return;
    }
    if (!writesEnabled) {
      setError(mismatchMessage);
      return;
    }
    if (parsed === 0n) {
      setError("Enter an amount.");
      return;
    }
    try {
      if (!quotedOut || Date.now() - quotedAt > QUOTE_TTL_MS) {
        await refreshQuote();
      }
      if (!quotedOut) {
        setError("Need a live quote before sending. Try a smaller exact-in size.");
        return;
      }
      if (Date.now() - quotedAt > QUOTE_TTL_MS) {
        setError("Quote went stale. Re-quoted — confirm again.");
        return;
      }
      const slipBps = BigInt(Math.max(1, Math.floor(Number(slippage || "1") * 100)));
      const minOut = (quotedOut * (10_000n - slipBps)) / 10_000n;
      if (minOut === 0n || minOut === 1n) {
        setError("minOut is dust after slippage. Increase size or tighten decimals.");
        return;
      }
      const bonding = Boolean(t.bonding && t.curve && !t.marketLive);
      const hops = sanitizeRouteHops(liveHops);
      const kind = usdcRoute && userRoute.address ? "userRoute" : bonding ? "curve" : "router";
      const write = resolveTradeWrite({
        chainId,
        connected: address,
        token: t.token,
        quote: t.quote,
        curve: t.curve,
        kind,
        indexerTx: null,
        metadata: { name: t.name, image: t.image, website: t.website, twitter: t.twitter, telegram: t.telegram },
      });
      // API already applied slippage to minQuoteOut (quote units) and minOut (final).
      const firstMin = side === "sell" ? (minQuoteOut ?? minOut) : minOut;
      if (side === "sell" && usdcRoute && (firstMin === 0n || firstMin === 1n)) {
        setError("minQuoteOut is dust. Increase size.");
        return;
      }
      const spender = write.to;
      const asset = side === "buy" ? (usdcRoute ? addresses.USDC : write.quote) : write.token;
      const allowance = (await client.readContract({
        address: asset,
        abi: erc20.abi,
        functionName: "allowance",
        args: [address, spender],
      })) as bigint;
      if (allowance < parsed) {
        const approveHash = await writeContractAsync({
          address: asset,
          abi: erc20.abi,
          functionName: "approve",
          args: [spender, parsed * 4n],
        });
        await waitForTransactionReceipt(client, { hash: approveHash });
      }
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const tx =
        kind === "userRoute"
          ? await writeContractAsync({
              address: write.to,
              abi: userRoute.abi,
              functionName: side === "buy" ? "buy" : "sell",
              args:
                side === "buy"
                  ? [write.token, parsed, hops, minOut, deadline]
                  : [write.token, parsed, hops, firstMin, minOut, deadline],
            })
          : kind === "curve"
            ? await writeContractAsync({
                address: write.to,
                abi: curve.abi,
                functionName: side === "buy" ? "buy" : "sell",
                args: [write.token, parsed, minOut],
              })
            : await writeContractAsync({
                address: write.to,
                abi: router.abi,
                functionName: "swap",
                args: [
                  officialPoolKey(write.token, write.quote),
                  side === "buy" ? buyZeroForOne(write.token, write.quote) : !buyZeroForOne(write.token, write.quote),
                  -parsed,
                  minOut,
                  write.recipient,
                ],
              });
      await waitForTransactionReceipt(client, { hash: tx });
      setHash(tx);
    } catch (e) {
      setError(e instanceof TxGuardError || e instanceof Error ? e.message : "Trade failed.");
    }
  }

  const outDec = side === "buy" ? t.decimals : quoteDec;
  const outSym = side === "buy" ? t.symbol : t.quoteSymbol;

  return (
    <Card className="p-4">
      <div className="mb-3 flex rounded-full bg-black/30 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setQuotedOut(null);
              setFeeLegs([]);
              setAggregateImpactBps(0);
              setReactorFeeCount(0);
            }}
            className={`flex-1 rounded-full py-2 text-sm capitalize ${
              side === s ? "bg-cyan-300 text-zinc-950" : "text-zinc-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {t.quote.toLowerCase() !== addresses.USDC.toLowerCase() && userRoute.address && (
        <label className="mb-3 flex items-center gap-2 text-[12px] text-zinc-400">
          <input
            type="checkbox"
            checked={payUsdc}
            onChange={(e) => {
              setPayUsdc(e.target.checked);
              setQuotedOut(null);
            }}
          />
          {side === "buy" ? "Pay USDC (nested route → quote → market)" : "Receive USDC (market → quote → USDC)"}
        </label>
      )}
      <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">
        {side === "buy"
          ? `Pay ${usdcRoute ? "USDC" : t.quoteSymbol} (exact in)`
          : `Sell ${t.symbol} (exact in)`}
      </label>
      <Input
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setQuotedOut(null);
        }}
        inputMode="decimal"
        placeholder="0.0"
      />
      <div className="mt-3 space-y-1 text-xs text-zinc-400">
        {feeView.officialCount > 0 ? (
          <>
            <p>{feeView.headline}</p>
            {feeView.legs.map((leg, i) => (
              <p key={`${leg.quoteToken}-${leg.hopLabel}-${i}`}>{leg.line}</p>
            ))}
            {usdcRoute && feeView.officialCount > 1 ? (
              <p>Each official hop charges 3.5% in that hop’s quote — not 3.5% of USDC in.</p>
            ) : null}
          </>
        ) : side === "buy" ? (
          <p>Official 3.5% (2 / 1 / 0.5) is taken on each official REACTOR quote notional after Quote.</p>
        ) : (
          <p>
            First leg min is {t.quoteSymbol}
            {minQuoteOut !== null ? ` (${formatUnitsSafe(minQuoteOut, quoteDec, 6)})` : ""}; final min is{" "}
            {usdcRoute ? "USDC" : t.quoteSymbol}. Official 3.5% comes from the quote ticket fee legs.
          </p>
        )}
        <p>
          Quoted out:{" "}
          {quotedOut === null ? "—" : `${formatUnitsSafe(quotedOut, outDec, 6)} ${outSym}`}
          {quotedOut !== null && Date.now() - quotedAt > QUOTE_TTL_MS ? " (stale)" : ""}
        </p>
        <p>
          Stage: {t.bonding && !t.marketLive ? "bonding InstantCurve" : t.marketLive ? "graduated v4" : "not live"} ·
          3.5% final economics (2 / 1 / 0.5)
        </p>
        {usdcRoute && (
          <p className="font-mono text-[11px] text-zinc-500">
            Route {liveHops.length ? liveHops.map((h) => `${h.tokenIn.slice(0, 6)}→${h.tokenOut.slice(0, 6)}`).join(" · ") : "quote API — no wallet hop sim"}
          </p>
        )}
        {feeView.officialCount > 1 && (
          <p className="text-[11px] text-amber-100/90">
            Nested official hops each charge 3.5% in that hop’s quote (compound {aggregateImpactBps / 100}% before
            slippage). Aggregate is bps only — quote amounts from different assets are not added.
          </p>
        )}
        {quotedOut !== null && (
          <p>
            Min received @ {slippage}%:{" "}
            {formatUnitsSafe((quotedOut * (10_000n - BigInt(Math.max(1, Math.floor(Number(slippage || "1") * 100))))) / 10_000n, outDec, 6)}{" "}
            {outSym}
          </p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
        Slippage
        <Input className="h-8 w-16" value={slippage} onChange={(e) => setSlippage(e.target.value)} /> %
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={refreshQuote} disabled={!writesEnabled || parsed === 0n}>
          Quote
        </Button>
        <Button
          className="flex-1"
          onClick={submit}
          disabled={!writesEnabled || isPending || (!t.marketLive && !t.bonding)}
        >
          {!matched
            ? "Wrong network"
            : !t.marketLive && !t.bonding
              ? "Market not live"
              : isPending
                ? "Pending…"
                : `Confirm ${side}`}
        </Button>
      </div>
      {error && (
        <UntrustedText as="p" field="toast" className="mt-3 text-sm text-red-300">
          {error}
        </UntrustedText>
      )}
      {!matched && isConnected && (
        <UntrustedText as="p" field="toast" className="mt-3 text-sm text-red-300">
          {mismatchMessage}
        </UntrustedText>
      )}
      {t.ready && t.curve && !t.marketLive && (
        <Button
          className="mt-3 w-full"
          variant="outline"
          onClick={async () => {
            if (!client) return;
            try {
              const write = resolveTradeWrite({
                chainId,
                connected: address,
                token: t.token,
                quote: t.quote,
                curve: t.curve,
                kind: "curve",
                metadata: { name: t.name, image: t.image, website: t.website },
              });
              const tx = await writeContractAsync({
                address: write.to,
                abi: curve.abi,
                functionName: "graduate",
                args: [write.token],
              });
              await waitForTransactionReceipt(client, { hash: tx });
              setHash(tx);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Graduation failed");
            }
          }}
          disabled={!writesEnabled || isPending}
        >
          Graduate to locked v4
        </Button>
      )}
      {hash && <p className="mt-3 break-all font-mono text-[11px] text-cyan-200">tx {hash}</p>}
    </Card>
  );
}

export function RewardsModule({ t }: { t: LaunchToken }) {
  const { address, isConnected, writesEnabled, chainId } = useOfficialChain();
  const client = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const [pending, setPending] = useState<bigint | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!address || !client) return;
    const v = (await client.readContract({
      address: t.token,
      abi: tokenC.abi,
      functionName: "pendingRewards",
      args: [address],
    })) as bigint;
    setPending(v);
  }

  async function claim() {
    setMsg(null);
    if (!address) return;
    try {
      const write = resolveTradeWrite({
        chainId,
        connected: address,
        token: t.token,
        quote: t.quote,
        kind: "token",
        metadata: { name: t.name, image: t.image, website: t.website },
      });
      const hash = await writeContractAsync({
        address: write.to,
        abi: tokenC.abi,
        functionName: "claimRewards",
        args: [write.recipient],
      });
      if (client) await waitForTransactionReceipt(client, { hash });
      setMsg(`Claimed. ${hash}`);
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Claim failed");
    }
  }

  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Holder rewards</div>
      <p className="mt-1 text-[13px] text-zinc-400">
        2% of official-pool quote volume. No staking. Transfers are tax-free.
      </p>
      <p className="mt-2 font-mono text-xl text-white">
        {pending === null ? "—" : formatUnitsSafe(pending, t.quoteDecimals ?? 18, 6)}{" "}
        <span className="text-base text-zinc-500">{t.quoteSymbol}</span>
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" onClick={refresh} disabled={!isConnected}>
          Refresh
        </Button>
        <Button onClick={claim} disabled={!writesEnabled || isPending}>
          {isPending ? "Claiming…" : "Claim"}
        </Button>
      </div>
      {msg && (
        <UntrustedText as="p" field="toast" className="mt-3 break-all text-xs text-zinc-400">
          {msg}
        </UntrustedText>
      )}
    </Card>
  );
}
