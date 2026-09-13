"use client";

import { useParams, useRouter } from "next/navigation";
import { usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { useState } from "react";
import { factory, erc20 } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { parseUnitsSafe, formatUnitsSafe } from "@/lib/utils";
import { unwrapFair, useMarket } from "@/lib/hooks";
import { tokenPath } from "@/lib/untrusted-metadata";
import { FIXTURE_FAIR, REVIEW_FIXTURES } from "@/lib/review-fixtures";
import { resolveTradeWrite } from "@/lib/tx-guard";
import { useOperatedWrites } from "@/lib/use-operated-writes";
import { RestrictedNotice } from "@/components/restricted-notice";
import { UntrustedText } from "@/components/untrusted-text";
import { userVisibleFailure, type TelemetryEvent } from "@/lib/obs";
import { SupportRef } from "@/components/support-ref";

export default function FairPage() {
  const { id } = useParams<{ id: string }>();
  const fairId = BigInt(id);
  const router = useRouter();
  const { address, writesEnabled, mismatchMessage, chainId, policyBlocked, writeBlockMessage, writeButtonLabel } =
    useOperatedWrites();
  const client = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const [amount, setAmount] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState<TelemetryEvent | null>(null);

  const { data: fl, refetch, isError } = useReadContract({
    ...factory,
    functionName: "fairs",
    args: [fairId],
  });

  const chainRow = fl ? unwrapFair(fl) : null;
  const { data: launch } = useMarket(chainRow?.token);
  const row =
    REVIEW_FIXTURES && fairId === 1n && (!chainRow || chainRow.startTime === 0n)
      ? FIXTURE_FAIR
      : chainRow;
  if (!row && !isError) return <p className="text-sm text-zinc-400">Loading Batch Fair Launch…</p>;
  if (!row) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Fair launch not found</h1>
        <p className="mt-2 text-sm text-zinc-400">This auction id is not on the connected factory.</p>
      </div>
    );
  }
  const { token, quote, startTime: start, endTime: end, minRaise, totalBids, finalized, migrated } = row;
  const qdec = launch?.quoteDecimals ?? 8;
  const qsym = launch?.quoteSymbol ?? "QUOTE";

  async function bid() {
    setError(null);
    setSupport(null);
    if (policyBlocked || !writesEnabled) {
      setError(writeBlockMessage ?? mismatchMessage);
      return;
    }
    if (!address || !client) return;
    try {
      const write = resolveTradeWrite({
        chainId,
        connected: address,
        token,
        quote,
        kind: "factory",
        metadata: { name: launch?.name, image: launch?.image, website: launch?.website },
      });
      const raw = parseUnitsSafe(amount, qdec);
      const allowance = (await client.readContract({
        address: write.quote,
        abi: erc20.abi,
        functionName: "allowance",
        args: [write.recipient, write.to],
      })) as bigint;
      if (allowance < raw) {
        const h = await writeContractAsync({
          address: write.quote,
          abi: erc20.abi,
          functionName: "approve",
          args: [write.to, raw],
        });
        await waitForTransactionReceipt(client, { hash: h });
      }
      const tx = await writeContractAsync({
        address: write.to,
        abi: factory.abi,
        functionName: "bid",
        args: [fairId, raw],
      });
      await waitForTransactionReceipt(client, { hash: tx });
      refetch();
    } catch (e) {
      const visible = userVisibleFailure("tx", e, { path: "fair.bid" });
      setError(visible.message || "Bid failed");
      setSupport(visible.event);
    }
  }

  async function finalize() {
    setError(null);
    setSupport(null);
    if (!client) return;
    if (policyBlocked || !writesEnabled) {
      setError(writeBlockMessage ?? mismatchMessage);
      return;
    }
    try {
      const write = resolveTradeWrite({
        chainId,
        connected: address,
        token,
        quote,
        kind: "factory",
        metadata: { name: launch?.name, image: launch?.image },
      });
      const tx = await writeContractAsync({
        address: write.to,
        abi: factory.abi,
        functionName: "finalizeFairLaunch",
        args: [fairId],
      });
      await waitForTransactionReceipt(client, { hash: tx });
      refetch();
      if (launch) router.push(tokenPath(launch.token));
    } catch (e) {
      const visible = userVisibleFailure("tx", e, { path: "fair.finalize" });
      setError(visible.message || "Finalize failed");
      setSupport(visible.event);
    }
  }

  async function claim() {
    if (policyBlocked || !writesEnabled) {
      setError(writeBlockMessage ?? "REACTOR-operated services are not available for this request.");
      return;
    }
    if (!address) return;
    try {
      const write = resolveTradeWrite({
        chainId,
        connected: address,
        token,
        quote,
        kind: "factory",
        metadata: { name: launch?.name, image: launch?.image },
      });
      const tx = await writeContractAsync({
        address: write.to,
        abi: factory.abi,
        functionName: "claimFairTokens",
        args: [fairId, write.recipient],
      });
      if (client) await waitForTransactionReceipt(client, { hash: tx });
    } catch (e) {
      const visible = userVisibleFailure("tx", e, { path: "fair.claim" });
      setError(visible.message || "Claim failed");
      setSupport(visible.event);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between gap-2">
        <UntrustedText as="h1" field="name" className="text-2xl font-semibold">
          {launch?.name ?? "Batch Fair Launch"}
        </UntrustedText>
        {migrated ? <Badge>Market live</Badge> : finalized ? <Badge>Finalized</Badge> : <Badge>Auction open</Badge>}
      </div>
      <p className="mt-1 text-[13px] text-zinc-400">
        Pro-rata timed sale, not Uniswap CCA. 0% REACTOR charge until the official pool opens.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Bids</div>
          <div className="font-mono text-white">
            {formatUnitsSafe(totalBids, qdec, 4)} {qsym}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Min raise</div>
          <div className="font-mono text-white">{formatUnitsSafe(minRaise, qdec, 4)}</div>
        </Card>
      </div>
      <p className="mt-2 font-mono text-[11px] text-zinc-400">
        {utcStamp(start)} → {utcStamp(end)}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-zinc-400">{token}</p>
      <RestrictedNotice className="mt-4 rounded-[4px] border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-[13px] text-amber-50" />
      {!finalized && (
        <Card className="mt-4 space-y-2 p-4">
          <label htmlFor="fair-bid" className="block text-[11px] uppercase tracking-wider text-zinc-400">
            Bid amount
          </label>
          <Input id="fair-bid" aria-label="Bid amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={bid} disabled={!writesEnabled || isPending} data-testid="fair-bid">
              {writeButtonLabel("Place bid")}
            </Button>
            <Button className="flex-1" variant="outline" onClick={finalize} disabled={!writesEnabled || isPending}>
              {writeButtonLabel("Finalize")}
            </Button>
          </div>
        </Card>
      )}
      {finalized && (
        <div className="mt-4 flex gap-2">
          <Button onClick={claim} disabled={!writesEnabled} data-testid="fair-claim">
            {writeButtonLabel("Claim tokens / refund")}
          </Button>
          {launch?.marketLive && (
            <Button variant="outline" onClick={() => router.push(tokenPath(launch.token))}>
              Trade official pool
            </Button>
          )}
        </div>
      )}
      {error && (
        <div className="mt-3">
          <UntrustedText as="p" field="toast" className="text-sm text-red-300">
            {error}
          </UntrustedText>
          <SupportRef event={support} />
        </div>
      )}
    </div>
  );
}

function utcStamp(ts: bigint) {
  return new Date(Number(ts) * 1000).toISOString().replace(".000Z", "Z");
}
