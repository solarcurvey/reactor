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
  quotes?: number;
  tokens?: string[];
};

type Ops = {
  indexer?: { block?: number; head?: number; lag?: number; pools?: number; swaps?: number; chainTs?: number };
  keeper?: Beat | null;
  pricing?: { usdPegOneOnly?: boolean; stablecoinsAreNotDollar?: boolean };
};

export default function OpsPage() {
  const token =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("ops-token") ?? new URLSearchParams(window.location.search).get("token") ?? ""
      : "";
  const locked = (process.env.NEXT_PUBLIC_REACTOR_ENV ?? process.env.REACTOR_ENV ?? "").toUpperCase() === "PROD" && !token;
  const { data, isError, refetch, isLoading } = useQuery({
    queryKey: ["ops", token],
    queryFn: async () => {
      const headers: HeadersInit = token ? { "x-ops-token": token } : {};
      const [ops, top10, watchdog] = await Promise.all([
        fetch(`${INDEXER_URL}/ops`, { headers }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/reactor/top10").then((r) => r.json()).catch(() => ({ pauseEpoch: true, rows: [] })),
        fetch(`${INDEXER_URL}/keeper`).then((r) => r.json()).catch(() => null),
      ]);
      const packed = ops as Ops;
      return {
        ops: packed,
        health: packed.indexer ?? {},
        beat: (packed.keeper ?? watchdog) as Beat | null,
        top10,
      };
    },
    refetchInterval: 15_000,
  });

  const beat = data?.beat;
  const health = data?.health ?? {};
  const jobs = beat?.jobs ?? [];
  const pending = jobs.filter((j) => j.includes("pending") || j.includes("ambiguous"));

  if (locked) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold">Ops is private</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Production ops requires an <code>OPS_TOKEN</code>. Open <code>/ops?token=…</code> or set{" "}
          <code>sessionStorage.ops-token</code>. Not linked from public nav.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-white/8 pb-4">
        <p className="text-[11px] uppercase tracking-[0.28em] text-rx-cool">Internal</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Ops</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
          Internal only — not in public nav. Requires OPS_TOKEN. Keeper / Watchdog / Pricing signer keys stay isolated.
          Mainnet disabled.
        </p>
      </div>

      {isLoading && <p className="mt-6 text-sm text-zinc-400">Reading ops…</p>}
      {isError && (
        <div className="mt-6 rounded-[var(--rx-radius-card)] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          Ops read failed.{" "}
          <button className="underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Indexer"
          value={`#${health.block ?? "—"}`}
          sub={`lag ${health.lag ?? "—"} · pools ${health.pools ?? "—"} · swaps ${health.swaps ?? "—"}`}
        />
        <Stat
          label="Keeper"
          value={beat?.mode ?? "no beat"}
          sub={`${beat?.ok === false ? "FAIL " : ""}${beat?.reason ?? "start indexer keeper"}`}
        />
        <Stat
          label="Top-10"
          value={data?.top10?.pauseEpoch ? "paused" : `${data?.top10?.rows?.length ?? 0} names`}
          sub={data?.top10?.reason || (data?.top10?.pauseEpoch ? "fail-closed" : "confident")}
        />
        <Stat
          label="Pricing"
          value={data?.ops?.pricing?.usdPegOneOnly ? "usdPegOne" : "unknown"}
          sub="EURC / Stablecoins category is not $1"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Heartbeat</div>
          <dl className="mt-2 space-y-1 font-mono text-[12px] text-zinc-300">
            <Row k="chainId" v={String(beat?.chainId ?? "—")} />
            <Row k="block" v={String(beat?.block ?? health.head ?? "—")} />
            <Row k="quotes discovered" v={String(beat?.quotes ?? "—")} />
            <Row k="pending / ambiguous" v={pending.length ? pending.join(" · ") : "none"} />
            <Row k="last jobs" v={jobs.slice(-6).join(" · ") || "idle"} />
          </dl>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Watchdog</div>
          <p className="mt-2 text-[13px] text-zinc-300">
            Independent process. Separate keys from Keeper / Guardian. Fail-closed on stale beat, weak minOut, unexpected
            target, ambiguous RPC, missing burn.
          </p>
          <p className="mt-2 font-mono text-[11px] text-zinc-400">
            {beat?.ok === false ? "keeper fail-closed — watchdog should alert" : "await /data/watchdog-alerts.json"}
          </p>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Confidence</div>
          <p className="mt-2 text-[13px] text-zinc-300">
            Marks are 10–15m official VWAP (chain timestamps). Dead low-value graduates do not freeze the epoch.
            Material unvalued candidates pause.
          </p>
          <p className="mt-2 font-mono text-[11px] text-zinc-400">
            {data?.top10?.pauseEpoch ? data?.top10?.reason : `${data?.top10?.rows?.length ?? 0} / 10`}
          </p>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-zinc-400">{label}</div>
      <p className="mt-2 font-mono text-lg text-white">{value}</p>
      <p className="text-[12px] text-zinc-400">{sub}</p>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-zinc-400">{k}</dt>
      <dd className="truncate text-right text-zinc-200">{v}</dd>
    </div>
  );
}
