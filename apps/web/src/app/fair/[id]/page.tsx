"use client";

import { useParams, useRouter } from "next/navigation";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { useState } from "react";
import { factory, erc20 } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { parseUnitsSafe, formatUnitsSafe } from "@/lib/utils";
import { unwrapFair, useLaunchTokens } from "@/lib/hooks";

export default function FairPage() {
  const { id } = useParams<{ id: string }>();
  const fairId = BigInt(id);
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const { data: tokens } = useLaunchTokens();
  const [amount, setAmount] = useState("100");
  const [error, setError] = useState<string | null>(null);

  const { data: fl, refetch } = useReadContract({
    ...factory,
    functionName: "fairs",
    args: [fairId],
  });

  const launch = tokens?.find((t) => t.fairId === fairId);
  if (!fl) return <p className="text-sm text-zinc-500">Loading auction…</p>;
  const row = unwrapFair(fl);
  const { token, quote, startTime: start, endTime: end, minRaise, totalBids, finalized, migrated } = row;
  const qdec = launch?.quoteDecimals ?? 8;
  const qsym = launch?.quoteSymbol ?? "QUOTE";

  async function bid() {
    setError(null);
    if (!address || !client) return;
    try {
      const raw = parseUnitsSafe(amount, qdec);
      const allowance = (await client.readContract({
        address: quote,
        abi: erc20.abi,
        functionName: "allowance",
        args: [address, factory.address],
      })) as bigint;
      if (allowance < raw) {
        const h = await writeContractAsync({
          address: quote,
          abi: erc20.abi,
          functionName: "approve",
          args: [factory.address, raw],
        });
        await waitForTransactionReceipt(client, { hash: h });
      }
      const tx = await writeContractAsync({
        ...factory,
        functionName: "bid",
        args: [fairId, raw],
      });
      await waitForTransactionReceipt(client, { hash: tx });
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bid failed");
    }
  }

  async function finalize() {
    setError(null);
    if (!client) return;
    try {
      const tx = await writeContractAsync({
        ...factory,
        functionName: "finalizeFairLaunch",
        args: [fairId],
      });
      await waitForTransactionReceipt(client, { hash: tx });
      refetch();
      if (launch) router.push(`/token/${launch.token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Finalize failed");
    }
  }

  async function claim() {
    if (!address) return;
    const tx = await writeContractAsync({
      ...factory,
      functionName: "claimFairTokens",
      args: [fairId, address],
    });
    if (client) await waitForTransactionReceipt(client, { hash: tx });
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">{launch?.name ?? "Fair launch"}</h1>
        {migrated ? <Badge>Market live</Badge> : finalized ? <Badge>Finalized</Badge> : <Badge>Auction open</Badge>}
      </div>
      <p className="mt-2 text-sm text-zinc-400">
        0% REACTOR charge during the auction. The 3% official-pool economics begin only after a single migration.
      </p>
      <Card className="mt-6 space-y-2 p-5 text-sm">
        <Row k="Token" v={token} />
        <Row k="Bids" v={`${formatUnitsSafe(totalBids, qdec, 4)} ${qsym}`} />
        <Row k="Min raise" v={formatUnitsSafe(minRaise, qdec, 4)} />
        <Row k="Window" v={`${new Date(Number(start) * 1000).toLocaleString()} → ${new Date(Number(end) * 1000).toLocaleString()}`} />
      </Card>
      {!finalized && (
        <Card className="mt-4 space-y-3 p-5">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button className="w-full" onClick={bid} disabled={!isConnected || isPending}>
            Place bid
          </Button>
          <Button className="w-full" variant="outline" onClick={finalize} disabled={isPending}>
            Finalize (after end)
          </Button>
        </Card>
      )}
      {finalized && (
        <div className="mt-4 flex gap-2">
          <Button onClick={claim} disabled={!isConnected}>
            Claim tokens / refund
          </Button>
          {launch?.marketLive && (
            <Button variant="outline" onClick={() => router.push(`/token/${launch.token}`)}>
              Trade official pool
            </Button>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/6 py-2">
      <span className="text-zinc-500">{k}</span>
      <span className="break-all text-right font-mono text-xs text-zinc-200">{v}</span>
    </div>
  );
}
