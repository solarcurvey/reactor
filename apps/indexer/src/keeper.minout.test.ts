import { conservativeMinOut, stampHopMinOuts, stampProductionHops } from "./keeper.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const m = conservativeMinOut(10_000n, 150n);
  assert(m === 9850n, `got ${m}`);
}
{
  let threw = false;
  try {
    conservativeMinOut(1n, 150n);
  } catch {
    threw = true;
  }
  assert(threw, "minOut=1 must be rejected");
}
{
  let threw = false;
  try {
    conservativeMinOut(0n, 150n);
  } catch {
    threw = true;
  }
  assert(threw, "minOut=0 must be rejected");
}

{
  let threw = false;
  try {
    stampProductionHops(
      [
        { adapter: "0x1", tokenIn: "0x2", tokenOut: "0x3", minOut: 1n, data: "0x" },
        { adapter: "0x1", tokenIn: "0x3", tokenOut: "0x4", minOut: 1n, data: "0x" },
      ],
      9_850n,
    );
  } catch {
    threw = true;
  }
  assert(threw, "stampProductionHops must refuse multi-hop last-leg reuse");
}

{
  const hops = stampHopMinOuts(
    [
      { adapter: "0x1", tokenIn: "0x2", tokenOut: "0x3", minOut: 1n, data: "0x" },
      { adapter: "0x1", tokenIn: "0x3", tokenOut: "0x4", minOut: 1n, data: "0x" },
    ],
    [80_000_000n, 5_000_000n],
  );
  assert(hops[0]!.minOut === conservativeMinOut(80_000_000n), `hop0 ${hops[0]!.minOut}`);
  assert(hops[1]!.minOut === conservativeMinOut(5_000_000n), `hop1 ${hops[1]!.minOut}`);
  assert(hops[0]!.minOut !== hops[1]!.minOut, "intermediate floor != last-leg");
  assert(hops[0]!.minOut > 1n && hops[1]!.minOut > 1n, "no dust");
}

{
  let threw = false;
  try {
    stampHopMinOuts(
      [
        { adapter: "0x1", tokenIn: "0x2", tokenOut: "0x3", minOut: 1n, data: "0x" },
        { adapter: "0x1", tokenIn: "0x3", tokenOut: "0x4", minOut: 1n, data: "0x" },
      ],
      [5_000_000n, 5_000_000n],
    );
  } catch {
    threw = true;
  }
  assert(threw, "identical last-leg reuse on intermediate must throw");
}

{
  const one = stampProductionHops(
    [{ adapter: "0x1", tokenIn: "0x2", tokenOut: "0x3", minOut: 1n, data: "0x" }],
    9_850n,
  );
  assert(one[0]!.minOut === 9_850n, "single hop ok");
}

console.log("keeper minOut tests ok");
