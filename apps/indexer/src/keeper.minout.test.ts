import { conservativeMinOut, stampProductionHops } from "./keeper.ts";

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
  const hops = stampProductionHops(
    [
      { adapter: "0x1", tokenIn: "0x2", tokenOut: "0x3", minOut: 1n, data: "0x" },
      { adapter: "0x1", tokenIn: "0x3", tokenOut: "0x4", minOut: 1n, data: "0x" },
    ],
    9_850n,
  );
  assert(hops[0]!.minOut === 9_850n, "intermediate must not stay at 1");
  assert(hops[1]!.minOut === 9_850n, "final hop uses sim minOut");
}
{
  let threw = false;
  try {
    stampProductionHops([], 1n);
  } catch {
    threw = true;
  }
  assert(threw, "stampProductionHops rejects dust minOut");
}

console.log("keeper minOut tests ok");
