"use client";

import { useAccount, usePublicClient } from "wagmi";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLaunchTokens } from "@/lib/hooks";
import { token as tokenC } from "@/lib/contracts";
import { formatUnitsSafe } from "@/lib/utils";
import Link from "next/link";

export default function RewardsPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { data: tokens, isLoading } = useLaunchTokens();
  const [rows, setRows] = useState<{ token: string; symbol: string; quote: string; pending: bigint; dec: number }[]>([]);

  useEffect(() => {
    if (!address || !client || !tokens) return;
    let cancel = false;
    (async () => {
      const next = [];
      for (const t of tokens) {
        const pending = (await client.readContract({
          address: t.token,
          abi: tokenC.abi,
          functionName: "pendingRewards",
          args: [address],
        })) as bigint;
        next.push({
          token: t.token,
          symbol: t.symbol,
          quote: t.quoteSymbol ?? "",
          pending,
          dec: t.quoteDecimals ?? 18,
        });
      }
      if (!cancel) setRows(next);
    })();
    return () => {
      cancel = true;
    };
  }, [address, client, tokens]);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Rewards</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-400">
        Claimable quote from official-pool volume. No staking. 2% of official volume → holders in the quote you
        chose. Numbers are read from each token contract.
      </p>
      {!isConnected && <p className="mt-6 text-sm text-zinc-500">Connect a wallet to see your claimable balances.</p>}
      {isLoading && <p className="mt-6 text-sm text-zinc-500">Loading tokens…</p>}
      <div className="mt-6 space-y-3">
        {rows.map((r) => (
          <Card key={r.token} className="flex items-center justify-between p-4">
            <div>
              <div className="font-medium">${r.symbol}</div>
              <div className="font-mono text-sm text-zinc-400">
                {formatUnitsSafe(r.pending, r.dec, 6)} {r.quote}
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/token/${r.token}`}>Open</Link>
            </Button>
          </Card>
        ))}
        {isConnected && rows.length === 0 && !isLoading && (
          <p className="text-sm text-zinc-500">No launch tokens indexed on this factory yet.</p>
        )}
      </div>
    </div>
  );
}
