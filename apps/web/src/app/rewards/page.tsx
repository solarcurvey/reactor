"use client";

import { useAccount, usePublicClient } from "wagmi";
import { useEffect, useState } from "react";
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
    if (!tokens) return;
    if (!address || !client) {
      setRows(
        tokens.map((t) => ({
          token: t.token,
          symbol: t.symbol,
          quote: t.quoteSymbol ?? "",
          pending: 0n,
          dec: t.quoteDecimals ?? 18,
        })),
      );
      return;
    }
    let cancel = false;
    (async () => {
      const next = [];
      for (const t of tokens) {
        try {
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
        } catch {
          next.push({
            token: t.token,
            symbol: t.symbol,
            quote: t.quoteSymbol ?? "",
            pending: 0n,
            dec: t.quoteDecimals ?? 18,
          });
        }
      }
      if (!cancel) setRows(next);
    })();
    return () => {
      cancel = true;
    };
  }, [address, client, tokens]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Rewards</h1>
      <p className="mt-1 max-w-xl text-[13px] text-zinc-400">
        2% of official volume → holders in the quote you chose. No staking. Connect to load claimable balances.
      </p>
      {!isConnected && (
        <p className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[13px] text-zinc-400">
          Wallet disconnected — showing markets with claimable = 0. Connect to read your balances.
        </p>
      )}
      {isLoading && <p className="mt-4 text-sm text-zinc-500">Loading tokens…</p>}
      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/8">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Token</th>
                <th className="px-3 py-2 font-medium">Claimable</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.token} className="border-t border-white/6">
                  <td className="px-3 py-2 font-medium text-white">${r.symbol}</td>
                  <td className="px-3 py-2 font-mono text-zinc-300">
                    {formatUnitsSafe(r.pending, r.dec, 6)} {r.quote}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/token/${r.token}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isConnected && rows.length === 0 && !isLoading && (
        <p className="mt-6 text-sm text-zinc-500">No launch tokens indexed on this factory yet.</p>
      )}
    </div>
  );
}
