import { splitQuoteFee, applySlippage, REACTOR_FEE_BPS } from "../../../packages/reactor/src/quote.ts";
import { assertKeySeparation } from "./keeper-jobs.ts";

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
