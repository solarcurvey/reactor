import { rankTop10, materialUncertainty } from "./top10.ts";

function c(partial: Partial<Parameters<typeof rankTop10>[0][number]> & { token: string }) {
  return {
    graduated: true,
    isCore: false,
    markUsdc: 400_000n * 1_000_000n,
    markOk: true,
    ...partial,
  };
}

const cases: Array<[string, () => void]> = [
  [
    "skips ungraduated",
    () => {
      const { rows, pauseEpoch } = rankTop10([c({ token: "0x1", graduated: false })]);
      if (rows.length !== 0 || pauseEpoch) throw new Error("ungraduated leaked");
    },
  ],
  [
    "skips CORE",
    () => {
      const { rows } = rankTop10([c({ token: "0xcore", isCore: true, markUsdc: 9_000_000n * 1_000_000n })]);
      if (rows.length !== 0) throw new Error("CORE ranked");
    },
  ],
  [
    "irrelevant inactivity does not pause",
    () => {
      const { rows, pauseEpoch } = rankTop10([
        c({ token: "0x2", markOk: false, markUsdc: 0n, tradeCount: 1, lastGoodMarkUsdc: 12_000n * 1_000_000n }),
      ]);
      if (rows.length !== 0 || pauseEpoch) throw new Error("dead low-value must not freeze");
    },
  ],
  [
    "thousands of inactive markets do not freeze",
    () => {
      const dead = Array.from({ length: 3000 }, (_, i) =>
        c({
          token: `0xdead${i}`,
          markOk: false,
          markUsdc: 0n,
          tradeCount: i % 3,
          lastGoodMarkUsdc: 1_000n * 1_000_000n,
          liquidityUsdc: 100n * 1_000_000n,
        }),
      );
      const { rows, pauseEpoch } = rankTop10([c({ token: "0xlive", markUsdc: 400_000n * 1_000_000n }), ...dead]);
      if (pauseEpoch || rows.length !== 1 || rows[0]!.token !== "0xlive") throw new Error("inactive flood froze epoch");
    },
  ],
  [
    "weights sum 100%",
    () => {
      const { rows } = rankTop10([
        c({ token: "0xa", markUsdc: 600_000n * 1_000_000n, symbol: "A" }),
        c({ token: "0xb", markUsdc: 400_000n * 1_000_000n, symbol: "B" }),
      ]);
      const sum = rows.reduce((s, r) => s + r.weightBps, 0);
      if (sum !== 10_000) throw new Error(`weights ${sum}`);
      if (rows[0]!.token !== "0xa" || rows[0]!.weightBps <= rows[1]!.weightBps) throw new Error("order");
    },
  ],
  [
    "below floor dropped",
    () => {
      const { rows } = rankTop10([
        c({ token: "0xa", markUsdc: 400_000n * 1_000_000n }),
        c({ token: "0xb", markUsdc: 100_000n * 1_000_000n }),
      ]);
      if (rows.length !== 1 || rows[0]!.weightBps !== 10_000) throw new Error("floor");
    },
  ],
  [
    "material unvalued pauses even if others qualify",
    () => {
      const { rows, pauseEpoch } = rankTop10([
        c({ token: "0xa", markUsdc: 400_000n * 1_000_000n }),
        c({ token: "0xb", markOk: false, markUsdc: 0n, priorRanked: true, lastGoodMarkUsdc: 500_000n * 1_000_000n }),
      ]);
      if (rows.length !== 0 || !pauseEpoch) throw new Error("must fail closed on material candidate");
      if (!materialUncertainty(c({ token: "0xb", markOk: false, priorRanked: true }))) throw new Error("material fn");
    },
  ],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log("ok", name);
  } catch (e) {
    failed++;
    console.error("fail", name, e);
  }
}
if (failed) process.exit(1);
