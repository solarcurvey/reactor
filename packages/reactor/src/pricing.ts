/**
 * External pricing adapters. Offchain only — no Solidity oracle.
 * Degraded consensus → do not sign launches / pause material Top-10. Trading continues.
 */

import { fuseExternalUsd6, type ExternalTick } from "./valuation.ts";

export type PriceProvider = {
  name: string;
  fetchUsd6(symbol: string, now: number): Promise<ExternalTick | null>;
};

export type Consensus = {
  usd6: bigint;
  ok: boolean;
  reason: string;
  degraded: boolean;
  n: number;
  sources: string[];
};

export class StaticProvider implements PriceProvider {
  constructor(
    public name: string,
    private marks: Map<string, { usd6: bigint; ts: number }>,
  ) {}
  async fetchUsd6(symbol: string, _now: number): Promise<ExternalTick | null> {
    const m = this.marks.get(symbol.toUpperCase());
    if (!m) return null;
    return { usd6: m.usd6, ts: m.ts, name: this.name };
  }
}

export class HttpJsonProvider implements PriceProvider {
  constructor(
    public name: string,
    private urlFor: (symbol: string) => string,
    private parse: (body: unknown) => { usd6: bigint; ts: number } | null,
  ) {}
  async fetchUsd6(symbol: string, _now: number): Promise<ExternalTick | null> {
    try {
      const res = await fetch(this.urlFor(symbol), { signal: AbortSignal.timeout(4_000) });
      if (!res.ok) return null;
      const parsed = this.parse(await res.json());
      if (!parsed || parsed.usd6 <= 0n) return null;
      return { ...parsed, name: this.name };
    } catch {
      return null;
    }
  }
}

export async function consensusUsd6(
  providers: PriceProvider[],
  symbol: string,
  now: number,
  opts?: { maxAgeSec?: number; maxDevBps?: number; arcUsd6?: bigint },
): Promise<Consensus> {
  const ticks: ExternalTick[] = [];
  for (const p of providers) {
    const t = await p.fetchUsd6(symbol, now);
    if (t) ticks.push(t);
  }
  const fused = fuseExternalUsd6(ticks, now, opts?.maxAgeSec ?? 120, opts?.maxDevBps ?? 150, opts?.arcUsd6);
  return {
    usd6: fused.usd6,
    ok: fused.ok,
    reason: fused.reason,
    degraded: !fused.ok,
    n: fused.n,
    sources: ticks.map((t) => t.name),
  };
}
