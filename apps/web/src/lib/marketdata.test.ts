import { fdvQuoteRaw, vwapFdvQuoteRaw, MIN_VWAP_SAMPLES } from "./marketdata.ts";
import { rankTop10 } from "./top10.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const Q96 = 1n << 96n;
  const fdv = fdvQuoteRaw(Q96, 1_000n, true);
  assert(fdv === 1_000n, `1:1 sqrt should mark supply as quote: ${fdv}`);
}

{
  const { rows, pauseEpoch } = rankTop10([
    { token: "0x1", graduated: true, isCore: false, markUsdc: 0n, markOk: false },
    { token: "0x2", graduated: false, isCore: false, markUsdc: 9_000_000n * 1_000_000n, markOk: true },
  ]);
  assert(rows.length === 0 && pauseEpoch, "unreliable-only set must pause, never guess");
}

{
  const { rows, pauseEpoch } = rankTop10([
    { token: "0x1", graduated: true, isCore: false, markUsdc: 400_000n * 1_000_000n, markOk: true },
    { token: "0x2", graduated: true, isCore: false, markUsdc: 0n, markOk: false },
  ]);
  assert(rows.length === 0 && pauseEpoch, "material unvalued graduate pauses the epoch");
}

{
  const Q96 = 1n << 96n;
  const now = 1_000_000;
  const samples = Array.from({ length: MIN_VWAP_SAMPLES }, (_, i) => ({
    notional: 100n,
    sqrtPrice: Q96,
    ts: now - 60 * i,
  }));
  const v = vwapFdvQuoteRaw(samples, 1_000n, true, now);
  assert(v.ok && v.fdv === 1_000n, `vwap 1:1 ${v.fdv}`);
  const thin = vwapFdvQuoteRaw(samples.slice(0, 1), 1_000n, true, now);
  assert(!thin.ok, "thin window fail-closed");
  const stale = vwapFdvQuoteRaw(
    samples.map((s) => ({ ...s, ts: now - 3600 })),
    1_000n,
    true,
    now,
  );
  assert(!stale.ok, "stale window fail-closed");
}

{
  const { rows, pauseEpoch } = rankTop10([
    { token: "0xcore", graduated: true, isCore: true, markUsdc: 9_000_000n * 1_000_000n, markOk: true },
  ]);
  assert(rows.length === 0 && !pauseEpoch, "CORE never ranks");
}

{
  const { rows } = rankTop10([
    { token: "0xa", graduated: true, isCore: false, markUsdc: 100_000n * 1_000_000n, markOk: true },
  ]);
  assert(rows.length === 0, "$250k floor fail-closed");
}

console.log("marketdata tests ok");
