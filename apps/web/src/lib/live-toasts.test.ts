import { isLiveAfterHead, mergeLiveToasts, toastDedupeKey, toastFromLiveEvent } from "./live-toasts.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const coreTx = `0x${"11".repeat(32)}`;
const topTx = `0x${"22".repeat(32)}`;
const token = `0x${"33".repeat(20)}`;

const coreBuy = toastFromLiveEvent({
  type: "core",
  id: 11,
  data: {
    name: "BuybackExecuted",
    tx: coreTx,
    quoteIn: "2500000",
    coreOut: "1000000000000000000",
    confirmed: true,
  },
});
assert(coreBuy?.kind === "core", "CORE BuybackExecuted toasts");
assert(coreBuy.title.includes("CORE"), "CORE title");
assert(coreBuy.body.includes("1 CORE"), `CORE burned body: ${coreBuy.body}`);
assert(coreBuy.body.includes("2.5"), `quote in body: ${coreBuy.body}`);
assert(coreBuy.id === toastDedupeKey("core", coreTx), "CORE dedupe is per tx");

const coreBurn = toastFromLiveEvent({
  type: "core",
  id: 12,
  data: { name: "COREBurned", tx: coreTx, coreOut: "1000000000000000000", confirmed: true },
});
assert(coreBurn?.id === coreBuy.id, "COREBurned same tx merges with BuybackExecuted");

const merged = mergeLiveToasts([coreBuy], coreBurn);
assert(merged.length === 1, "one CORE toast per tx");
assert(merged[0].title.includes("CORE"), "merged keeps CORE title");

const top = toastFromLiveEvent({
  type: "burn",
  id: 13,
  data: {
    name: "Top10Buy",
    tx: topTx,
    token,
    amount: "4000000",
    burned: "2000000000000000000",
    confirmed: true,
  },
});
assert(top?.kind === "top10", "Top10Buy toasts");
assert(top.title.includes("Top-10"), "Top-10 title");
assert(top.body.includes("2"), `Top-10 burned: ${top.body}`);
assert(top.body.includes("4"), `Top-10 USDC: ${top.body}`);

assert(toastFromLiveEvent({ type: "burn", data: { name: "SelfBurnAccrued", tx: topTx, confirmed: true } }) === null, "no SelfBurnAccrued toast");
assert(toastFromLiveEvent({ type: "burn", data: { name: "SelfBurnExecuted", tx: topTx, burned: "1", confirmed: true } }) === null, "no SelfBurnExecuted toast");
assert(toastFromLiveEvent({ type: "burn", data: { name: "Burned", tx: topTx, token, confirmed: true } }) === null, "no holder burn toast");
assert(toastFromLiveEvent({ type: "top10", data: { epochId: "1", pot: "9" } }) === null, "no EpochSubmitted toast");
assert(toastFromLiveEvent({ type: "core", data: { name: "BuybackExecuted", tx: "" } }) === null, "no toast without tx");
assert(toastFromLiveEvent({ type: "core", data: { name: "BuybackExecuted", tx: coreTx, confirmed: false } }) === null, "unconfirmed skipped");
assert(toastFromLiveEvent({ type: "trade", data: { tx: coreTx } }) === null, "trades do not toast");
assert(toastFromLiveEvent({ type: "hello", data: { ok: true, last: 0, head: 10 } }) === null, "hello is not a toast");

assert(isLiveAfterHead(11, 10) === true, "id > head is live");
assert(isLiveAfterHead(10, 10) === false, "id == head is replay");
assert(isLiveAfterHead(9, 10) === false, "id < head is replay");
assert(isLiveAfterHead(undefined, 10) === false, "missing id is not live");

const stacked = mergeLiveToasts(
  mergeLiveToasts(mergeLiveToasts(mergeLiveToasts([coreBuy], top), { ...coreBuy, id: "core:0xaaa", tx: "0xaaa" }), {
    ...top,
    id: "top10:0xbbb:",
    tx: "0xbbb",
  }),
  { ...top, id: "top10:0xccc:", tx: "0xccc" },
);
assert(stacked.length === 4, "cap at 4");
assert(!stacked.some((t) => t.id === coreBuy.id), "oldest dropped");

console.log("live-toasts.test.ts: ok");
