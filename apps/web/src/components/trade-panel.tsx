"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { erc20, router, token as tokenC, curve } from "@/lib/contracts";
import { officialPoolKey, buyZeroForOne } from "@/lib/pool";
import { feeSplit, formatUnitsSafe, parseUnitsSafe } from "@/lib/utils";
import type { LaunchToken } from "@/lib/hooks";
import { addresses } from "@/lib/addresses";

const QUOTE_TTL_MS = 30_000;

export function TradePanel({ t }: { t: LaunchToken }) {
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [quotedOut, setQuotedOut] = useState<bigint | null>(null);
  const [quotedAt, setQuotedAt] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const quoteDec = t.quoteDecimals ?? 18;
  const parsed = parseUnitsSafe(amount, side === "buy" ? quoteDec : t.decimals);
  const split = feeSplit(parsed);

  async function refreshQuote() {
    setError(null);
    if (!address || !client || parsed === 0n) {
      setQuotedOut(null);
      return;
    }
    const bonding = Boolean(t.bonding && t.curve && !t.marketLive);
    try {
      const sim = bonding
        ? await client.simulateContract({
            address: t.curve!,
            abi: curve.abi,
            functionName: side === "buy" ? "buy" : "sell",
            args: [t.token, parsed, 1n],
            account: address,
          })
        : await client.simulateContract({
            ...router,
            functionName: "swap",
            args: [
              officialPoolKey(t.token, t.quote),
              side === "buy" ? buyZeroForOne(t.token, t.quote) : !buyZeroForOne(t.token, t.quote),
              -parsed,
              1n,
              address,
            ],
            account: address,
          });
      setQuotedOut(sim.result as bigint);
      setQuotedAt(Date.now());
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
      if (minOut === 0n) {
        setError("minOut is zero after slippage. Increase size or tighten decimals.");
        return;
      }
      const bonding = Boolean(t.bonding && t.curve && !t.marketLive);
      const spender = bonding ? t.curve! : addresses.ReactorRouter;
      const asset = side === "buy" ? t.quote : t.token;
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
      const tx = bonding
        ? await writeContractAsync({
            address: t.curve!,
            abi: curve.abi,
            functionName: side === "buy" ? "buy" : "sell",
            args: [t.token, parsed, minOut],
          })
        : await writeContractAsync({
            ...router,
            functionName: "swap",
            args: [
              officialPoolKey(t.token, t.quote),
              side === "buy" ? buyZeroForOne(t.token, t.quote) : !buyZeroForOne(t.token, t.quote),
              -parsed,
              minOut,
              address,
            ],
          });
      await waitForTransactionReceipt(client, { hash: tx });
      setHash(tx);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade failed.");
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
            }}
            className={`flex-1 rounded-full py-2 text-sm capitalize ${
              side === s ? "bg-cyan-300 text-zinc-950" : "text-zinc-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">
        {side === "buy" ? `Pay ${t.quoteSymbol} (exact in)` : `Sell ${t.symbol} (exact in)`}
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
        {side === "buy" ? (
          <p>
            Est. {formatUnitsSafe(split.fee, quoteDec, 6)} {t.quoteSymbol} ·{" "}
            {formatUnitsSafe(split.holders, quoteDec, 6)} holders / {formatUnitsSafe(split.flywheel, quoteDec, 6)}{" "}
            flywheel / {formatUnitsSafe(split.core, quoteDec, 6)} CORE
          </p>
        ) : (
          <p>You receive quote after the 3.5% charge (2/1/0.5). No token transfer tax.</p>
        )}
        <p>
          Quoted out:{" "}
          {quotedOut === null ? "—" : `${formatUnitsSafe(quotedOut, outDec, 6)} ${outSym}`}
          {quotedOut !== null && Date.now() - quotedAt > QUOTE_TTL_MS ? " (stale)" : ""}
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
        Slippage
        <Input className="h-8 w-16" value={slippage} onChange={(e) => setSlippage(e.target.value)} /> %
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={refreshQuote} disabled={!isConnected || parsed === 0n}>
          Quote
        </Button>
        <Button
          className="flex-1"
          onClick={submit}
          disabled={!isConnected || isPending || (!t.marketLive && !t.bonding)}
        >
          {!t.marketLive && !t.bonding ? "Market not live" : isPending ? "Pending…" : `Confirm ${side}`}
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {t.ready && t.curve && !t.marketLive && (
        <Button
          className="mt-3 w-full"
          variant="outline"
          onClick={async () => {
            if (!client) return;
            try {
              const tx = await writeContractAsync({
                address: t.curve!,
                abi: curve.abi,
                functionName: "graduate",
                args: [t.token],
              });
              await waitForTransactionReceipt(client, { hash: tx });
              setHash(tx);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Graduation failed");
            }
          }}
        >
          Graduate to locked v4
        </Button>
      )}
      {hash && <p className="mt-3 break-all font-mono text-[11px] text-cyan-200">tx {hash}</p>}
    </Card>
  );
}

export function RewardsModule({ t }: { t: LaunchToken }) {
  const { address, isConnected } = useAccount();
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
      const hash = await writeContractAsync({
        address: t.token,
        abi: tokenC.abi,
        functionName: "claimRewards",
        args: [address],
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
        <Button onClick={claim} disabled={!isConnected || isPending}>
          {isPending ? "Claiming…" : "Claim"}
        </Button>
      </div>
      {msg && <p className="mt-3 break-all text-xs text-zinc-400">{msg}</p>}
    </Card>
  );
}
