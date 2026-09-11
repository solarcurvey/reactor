import { planRoute, RouteReject, MAX_LEGS, applyMinOuts } from "./routes.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const USDC = "0x0000000000000000000000000000000000000001";
const ZEC = "0x0000000000000000000000000000000000000002";
const ZCAT = "0x0000000000000000000000000000000000000003";
const CAT = "0x0000000000000000000000000000000000000004";
const ADAPTER = "0x00000000000000000000000000000000000000aa";

const quotes = new Map(
  [USDC, ZEC, ZCAT, CAT].map((t) => [t.toLowerCase(), { token: t, symbol: t.slice(0, 6), enabled: true }]),
);
const edges = [
  { from: ZCAT, to: ZEC, adapter: ADAPTER, kind: "protocol" as const, data: "0x01" as `0x${string}`, usable: true },
  { from: ZEC, to: USDC, adapter: ADAPTER, kind: "protocol" as const, data: "0x02" as `0x${string}`, usable: true },
  { from: USDC, to: ZEC, adapter: ADAPTER, kind: "protocol" as const, data: "0x03" as `0x${string}`, usable: true },
  { from: ZEC, to: ZCAT, adapter: ADAPTER, kind: "protocol" as const, data: "0x04" as `0x${string}`, usable: true },
  { from: ZCAT, to: CAT, adapter: ADAPTER, kind: "protocol" as const, data: "0x05" as `0x${string}`, usable: true },
];
const adapters = new Set([ADAPTER]);

{
  const r = planRoute(ZCAT, USDC, edges, quotes, { protocol: true, adapters });
  assert(r.hops.length === 2 && r.path.length === 3, `nested settle ${r.path}`);
}
{
  const r = planRoute(USDC, CAT, edges, quotes, { protocol: true, adapters });
  assert(r.hops.length === 3, `nested top10 ${r.path}`);
}
{
  let threw = false;
  try {
    planRoute(CAT, USDC, edges, quotes, { protocol: true, adapters });
  } catch (e) {
    threw = e instanceof RouteReject;
  }
  assert(threw, "no reverse CAT route");
}
{
  const q = new Map(quotes);
  q.set(ZEC.toLowerCase(), { token: ZEC, symbol: "ZEC", quarantined: true, enabled: false });
  let threw = false;
  try {
    planRoute(ZCAT, USDC, edges, q, { protocol: true, adapters });
  } catch {
    threw = true;
  }
  assert(threw, "quarantined mid-hop rejected");
}
assert(MAX_LEGS === 3, "max 3");
{
  const r = planRoute(ZCAT, USDC, edges, quotes, { protocol: true, adapters });
  const stamped = applyMinOuts(r, [80_000_000n, 5_000_000n]);
  assert(stamped.hops[0]!.minOut === 80_000_000n && stamped.hops[1]!.minOut === 5_000_000n, "per-hop floors");
}
{
  const r = planRoute(ZCAT, USDC, edges, quotes, { protocol: true, adapters });
  let threw = false;
  try {
    applyMinOuts(r, [5_000_000n, 5_000_000n]);
  } catch {
    threw = true;
  }
  assert(threw, "applyMinOuts rejects last-leg reuse");
}
console.log("routes tests ok");
