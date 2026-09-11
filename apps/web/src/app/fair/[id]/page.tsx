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
import { FIXTURE_FAIR, REVIEW_FIXTURES } from "@/lib/review-fixtures";

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

  const { data: fl, refetch, isError } = useReadContract({
    ...factory,
    functionName: "fairs",
    args: [fairId],
  });

  const launch = tokens?.find((t) => t.fairId === fairId);
  const chainRow = fl ? unwrapFair(fl) : null;
  const row =
    REVIEW_FIXTURES && fairId === 1n && (!chainRow || chainRow.startTime === 0n)
      ? FIXTURE_FAIR
      : chainRow;
  if (!row && !isError) return <p className="text-sm text-zinc-500">Loading Batch Fair Launch…</p>;
  if (!row) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Fair launch not found</h1>
        <p className="mt-2 text-sm text-zinc-500">This auction id is not on the connected factory.</p>
      </div>
    );
  }
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{launch?.name ?? "Batch Fair Launch"}</h1>
        {migrated ? <Badge>Market live</Badge> : finalized ? <Badge>Finalized</Badge> : <Badge>Auction open</Badge>}
      </div>
      <p className="mt-1 text-[13px] text-zinc-400">
        Pro-rata timed sale, not Uniswap CCA. 0% REACTOR charge until the official pool opens.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Bids</div>
          <div className="font-mono text-white">
            {formatUnitsSafe(totalBids, qdec, 4)} {qsym}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Min raise</div>
          <div className="font-mono text-white">{formatUnitsSafe(minRaise, qdec, 4)}</div>
        </Card>
      </div>
      <p className="mt-2 font-mono text-[11px] text-zinc-500">
        {new Date(Number(start) * 1000).toLocaleString()} → {new Date(Number(end) * 1000).toLocaleString()}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">{token}</p>
      {!finalized && (
        <Card className="mt-4 space-y-2 p-4">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={bid} disabled={!isConnected || isPending}>
              Place bid
            </Button>
            <Button className="flex-1" variant="outline" onClick={finalize} disabled={isPending}>
              Finalize
            </Button>
          </div>
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
