"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { INDEXER_URL } from "@/lib/chain";
import { ALERT_THRESHOLDS, OUTAGE_CLASSES, reactorFetchCatch, releaseInfo } from "@/lib/obs";

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

type SanctionsOpsSnapshot = {
  freshness?: string;
  degraded?: boolean;
  dataset?: {
    versionId?: string | null;
    contentHash?: string | null;
    lastSuccessfulRefreshAt?: string | null;
    addressCount?: number;
  };
  policy?: {
    operatorPolicyVersion?: string;
    geoPolicyVersion?: string;
    operatedWritesEnabled?: boolean;
  };
  refresh?: { consecutiveFailures?: number; lastError?: string | null };
};

type Ops = {
  indexer?: { block?: number; head?: number; lag?: number; pools?: number; swaps?: number; chainTs?: number };
  keeper?: Beat | null;
  pricing?: { usdPegOneOnly?: boolean; stablecoinsAreNotDollar?: boolean };
  sanctions?: SanctionsOpsSnapshot;
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
        reactorFetchCatch(`${INDEXER_URL}/ops`, { headers }).then((r) => r?.json() ?? {}).catch(() => ({})),
        reactorFetchCatch("/api/reactor/top10").then((r) => r?.json() ?? { pauseEpoch: true, rows: [] }).catch(() => ({ pauseEpoch: true, rows: [] })),
        reactorFetchCatch(`${INDEXER_URL}/keeper`).then((r) => r?.json() ?? null).catch(() => null),
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
        <p className="rx-kicker">Internal</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Ops</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
          Internal only — not in public nav. Requires OPS_TOKEN. Keeper / Watchdog / Pricing signer keys stay isolated.
          Mainnet disabled.
        </p>
      </div>

      {isLoading && <p className="mt-6 text-sm text-zinc-400">Reading ops…</p>}
      {isError && (
        <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
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
        <Stat
          label="Sanctions"
          value={data?.ops?.sanctions?.dataset?.versionId ?? "no dataset"}
          sub={`${data?.ops?.sanctions?.freshness ?? "missing"} · policy ${data?.ops?.sanctions?.policy?.operatorPolicyVersion ?? "—"} · geo ${data?.ops?.sanctions?.policy?.geoPolicyVersion ?? "—"}`}
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
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Official-list / policy</div>
          <dl className="mt-2 space-y-1 font-mono text-[12px] text-zinc-300">
            <Row k="dataset" v={String(data?.ops?.sanctions?.dataset?.versionId ?? "—")} />
            <Row k="contentHash" v={String(data?.ops?.sanctions?.dataset?.contentHash ?? "—")} />
            <Row k="operator policy" v={String(data?.ops?.sanctions?.policy?.operatorPolicyVersion ?? "—")} />
            <Row k="geo policy" v={String(data?.ops?.sanctions?.policy?.geoPolicyVersion ?? "—")} />
            <Row k="last success" v={String(data?.ops?.sanctions?.dataset?.lastSuccessfulRefreshAt ?? "—")} />
            <Row k="refresh fails" v={String(data?.ops?.sanctions?.refresh?.consecutiveFailures ?? 0)} />
          </dl>
          <p className="mt-2 font-mono text-[11px] text-zinc-400">
            {data?.ops?.sanctions?.degraded ? "degraded — fail-closed writes" : "SLA current"} · writes{" "}
            {data?.ops?.sanctions?.policy?.operatedWritesEnabled === false ? "disabled" : "enabled"}
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

      <Card className="mt-3 p-4">
        <div className="rx-kicker">Web outage paging</div>
        <p className="mt-2 text-[13px] text-zinc-300">
          Encode the runbook: page on clustered render / API / RPC / quote / SSE / simulation. Expected wallet{" "}
          <code>4001</code> never pages. Release {releaseInfo().release} · {releaseInfo().reactorEnv} · chain{" "}
          {releaseInfo().chainId}.
        </p>
        <table className="mt-3 w-full text-left font-mono text-[11px] text-zinc-300">
          <thead>
            <tr className="text-zinc-400">
              <th className="pb-1">class</th>
              <th className="pb-1">count / window</th>
              <th className="pb-1">consecutive</th>
            </tr>
          </thead>
          <tbody>
            {OUTAGE_CLASSES.map((c) => {
              const t = ALERT_THRESHOLDS[c];
              return (
                <tr key={c}>
                  <td className="py-0.5">{c}</td>
                  <td>
                    {t.count} / {t.windowMs / 1000}s
                  </td>
                  <td>{t.consecutive}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
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
      <dt className="shrink-0 text-zinc-400">{k}</dt>
      <dd className="break-all text-right text-zinc-200">{v}</dd>
    </div>
  );
}
