import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitQuoteFee, applySlippage, REACTOR_FEE_BPS } from "../../../packages/reactor/src/quote.ts";
import { assertKeySeparation, saveJob } from "./keeper-jobs.ts";
import { openStore } from "./db.ts";
import { persistVenue, planFeeExemptRoute } from "./route-graph.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const s = splitQuoteFee(10_000n);
  assert(s.holders === 200n && s.flywheel === 100n && s.core === 50n && s.fee === 350n, "2/1/0.5");
  assert(REACTOR_FEE_BPS === 350, "3.5%");
}
{
  const m = applySlippage(10_000n, 150);
  assert(m === 9850n, `slip ${m}`);
  let threw = false;
  try {
    applySlippage(1n, 150);
  } catch {
    threw = true;
  }
  assert(threw, "dust slip rejected");
}
{
  let threw = false;
  try {
    assertKeySeparation({ keeper: "0x1", pricing: "0x1" });
  } catch {
    threw = true;
  }
  assert(threw, "key reuse rejected");
  assertKeySeparation({ keeper: "0x1", pricing: "0x2", guardian: "0x3" });
}
console.log("quote/key tests ok");

{
  const dir = mkdtempSync(join(tmpdir(), "reactor-quote-"));
  const store = await openStore({ sqlitePath: join(dir, "t.sqlite") });
  const proto = "0x00000000000000000000000000000000000000aa";
  const zec = "0x0000000000000000000000000000000000000002";
  const usdc = "0x0000000000000000000000000000000000000001";
  await persistVenue(store, {
    tokenIn: zec,
    tokenOut: usdc,
    adapter: proto,
    kind: "protocol",
    data: "0x02",
    exists: true,
    approved: true,
  });
  const adapters = new Set([proto]);
  const settle = await planFeeExemptRoute(store, zec, usdc, adapters);
  assert(settle.hops.length === 1 && settle.path.length === 2, `settle path ${settle.path}`);
  const identity = await planFeeExemptRoute(store, zec, zec, adapters);
  assert(identity.hops.length === 0 && identity.reason === "identity", "selfburn identity");
  await saveJob(store, "settle:0x2:1", { status: "done", ts: 1, note: settle.reason }, "MAINTENANCE_SETTLEMENT");
  await saveJob(store, "top10:1:0x3", { status: "pending", ts: 2, note: "planned" }, "TOP10_BUY");
  await saveJob(store, "selfburn:0x3:1", { status: "done", ts: 3 }, "SELFBURN");
  await saveJob(store, "core:0x2:1", { status: "done", ts: 4 }, "CORE_BUYBACK");
  const kinds = await store.all<{ kind: string }>("SELECT kind FROM keeper_operations ORDER BY ts");
  assert(
    kinds.map((k) => k.kind).join(",") === "MAINTENANCE_SETTLEMENT,TOP10_BUY,SELFBURN,CORE_BUYBACK",
    `job kinds ${kinds.map((k) => k.kind)}`,
  );
  await store.close();
  rmSync(dir, { recursive: true, force: true });
  console.log("maintenance planner + SQL jobs ok");
}
