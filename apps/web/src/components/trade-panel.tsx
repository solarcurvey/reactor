"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { erc20, router, token as tokenC } from "@/lib/contracts";
import { officialPoolKey, buyZeroForOne } from "@/lib/pool";
import { feeSplit, formatUnitsSafe, parseUnitsSafe } from "@/lib/utils";
import type { LaunchToken } from "@/lib/hooks";
import { addresses } from "@/lib/addresses";

export function TradePanel({ t }: { t: LaunchToken }) {
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const quoteDec = t.quoteDecimals ?? 18;
  const parsed = parseUnitsSafe(amount, side === "buy" ? quoteDec : t.decimals);
  const split = feeSplit(parsed);

  async function submit() {
    setError(null);
    setHash(null);
    if (!address || !client) {
      setError("Connect a wallet on chain 5042002.");
      return;
    }
    if (parsed === 0n) {
      setError("Enter an amount.");
      return;
    }
    try {
      const spender = addresses.ReactorRouter;
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
      const key = officialPoolKey(t.token, t.quote);
      const zfo = side === "buy" ? buyZeroForOne(t.token, t.quote) : !buyZeroForOne(t.token, t.quote);
      const slipBps = BigInt(Math.floor(Number(slippage || "1") * 100));
      const minOut = 0n;
      void slipBps;
      const tx = await writeContractAsync({
        ...router,
        functionName: "swap",
        args: [key, zfo, -parsed, minOut, address],
      });
      await waitForTransactionReceipt(client, { hash: tx });
      setHash(tx);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade failed.");
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex rounded-full bg-black/30 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`flex-1 rounded-full py-2 text-sm capitalize ${
              side === s ? "bg-cyan-300 text-zinc-950" : "text-zinc-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">
        {side === "buy" ? `Pay ${t.quoteSymbol} (all-in)` : `Sell ${t.symbol}`}
      </label>
      <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" />
      <div className="mt-3 space-y-1 text-xs text-zinc-400">
        {side === "buy" ? (
          <>
            <p>Protocol charge 3% of quote notional — included in the amount you pay.</p>
            <p>
              Est. fee {formatUnitsSafe(split.fee, quoteDec, 6)} {t.quoteSymbol} →{" "}
              {formatUnitsSafe(split.holders, quoteDec, 6)} holders / {formatUnitsSafe(split.buyback, quoteDec, 6)}{" "}
              buyback
            </p>
          </>
        ) : (
          <p>You receive quote after the 3% charge on quote notional. No token transfer tax.</p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
        Slippage
        <Input className="h-8 w-16" value={slippage} onChange={(e) => setSlippage(e.target.value)} /> %
      </div>
      <Button className="mt-4 w-full" onClick={submit} disabled={!isConnected || isPending || !t.marketLive}>
        {!t.marketLive ? "Market not live" : !isConnected ? "Connect to trade" : isPending ? "Pending…" : `Confirm ${side}`}
      </Button>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
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
    <Card className="p-5">
      <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Holder rewards</div>
      <p className="mt-1 text-sm text-zinc-300">
        2% of official-pool quote volume, claimable without staking. Transfers are tax-free; rewards stay with you.
      </p>
      <p className="mt-3 font-mono text-2xl text-white">
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
