"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { INDEXER_URL } from "@/lib/chain";

type Beat = {
  ok?: boolean;
  mode?: string;
  pauseEpoch?: boolean;
  reason?: string;
  n?: number;
  jobs?: string[];
  submitted?: boolean;
  chainId?: number;
  block?: string;
  ts?: number;
};

export default function OpsPage() {
  const { data, isError, refetch, isLoading } = useQuery({
    queryKey: ["ops"],
    queryFn: async () => {
      const [health, reactor, top10, beat] = await Promise.all([
        fetch(`${INDEXER_URL}/health`).then((r) => r.json()).catch(() => ({ ok: false })),
        fetch(`${INDEXER_URL}/reactor`).then((r) => r.json()).catch(() => ({ events: [] })),
        fetch("/api/reactor/top10").then((r) => r.json()).catch(() => ({ pauseEpoch: true, rows: [] })),
        fetch(`${INDEXER_URL}/keeper`).then((r) => r.json()).catch(() => null),
      ]);
      return { health, reactor, top10, beat: beat as Beat | null };
    },
    refetchInterval: 15_000,
  });

  return (
    <div>
      <div className="border-b border-white/8 pb-4">
        <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/80">Internal</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Ops</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
          Keeper heartbeat, indexer head, and Top-10 discovery. Not a public console. Mainnet is disabled.
        </p>
      </div>

      {isLoading && <p className="mt-6 text-sm text-zinc-500">Reading ops…</p>}
      {isError && (
        <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          Ops read failed.{" "}
          <button className="underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Indexer</div>
          <p className="mt-2 font-mono text-lg text-white">block {data?.health?.block ?? "—"}</p>
          <p className="text-[12px] text-zinc-500">{data?.health?.ok ? "healthy" : "down"}</p>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Keeper</div>
          <p className="mt-2 font-mono text-lg text-white">{data?.beat?.mode ?? "no beat"}</p>
          <p className="text-[12px] text-zinc-500">
            {data?.beat?.ok === false ? data?.beat?.reason : data?.beat?.reason ?? "start indexer keeper"}
          </p>
          {data?.beat?.jobs && (
            <p className="mt-2 font-mono text-[11px] text-zinc-400">{data.beat.jobs.join(" · ") || "idle"}</p>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Top-10</div>
          <p className="mt-2 font-mono text-lg text-white">
            {data?.top10?.pauseEpoch ? "paused" : `${data?.top10?.rows?.length ?? 0} names`}
          </p>
          <p className="text-[12px] text-zinc-500">{data?.top10?.reason}</p>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">Recent maintenance</div>
        <ul className="mt-3 space-y-1 font-mono text-[12px] text-zinc-400">
          {(data?.reactor?.events ?? []).slice(0, 20).map((e: { id?: number; name?: string; token?: string }) => (
            <li key={e.id}>
              {e.name} {e.token ? e.token.slice(0, 10) : ""}
            </li>
          ))}
          {(data?.reactor?.events ?? []).length === 0 && <li>No flywheel / CORE events indexed yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
