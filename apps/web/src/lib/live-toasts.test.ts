import {
  acceptLiveToast,
  applyHello,
  canonicalEventKey,
  clockExpired,
  createLiveSession,
  createToastClock,
  getLiveSession,
  hasSeenCanonical,
  identityFromLiveData,
  ingestLiveEvent,
  isLiveAfterHead,
  pauseToastClock,
  prefersReducedMotion,
  pushVisibleToast,
  resetLiveSessionForTests,
  resumeToastClock,
  streamEndpoint,
  toastFromLiveEvent,
  type LiveStreamEvent,
  type LiveToast,
} from "./live-toasts.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const chainId = 5042002;
const coreTx = `0x${"11".repeat(32)}`;
const topTx = `0x${"22".repeat(32)}`;
const token = `0x${"33".repeat(20)}`;

function coreEv(over: Partial<LiveStreamEvent["data"]> & { id?: number }): LiveStreamEvent {
  const { id, ...data } = over;
  return {
    type: "core",
    id: id ?? 11,
    data: {
      name: "BuybackExecuted",
      eventKind: "BuybackExecuted",
      tx: coreTx,
      chainId,
      logIndex: 1,
      quoteIn: "2500000",
      coreOut: "1000000000000000000",
      confirmed: true,
      ...data,
    },
  };
}

function topEv(over: Partial<LiveStreamEvent["data"]> & { id?: number } = {}): LiveStreamEvent {
  const { id, ...data } = over;
  return {
    type: "burn",
    id: id ?? 13,
    data: {
      name: "Top10Buy",
      eventKind: "Top10Buy",
      tx: topTx,
      token,
      chainId,
      logIndex: 3,
      amount: "4000000",
      burned: "2000000000000000000",
      confirmed: true,
      ...data,
    },
  };
}

const coreBuy = toastFromLiveEvent(coreEv({}));
assert(coreBuy?.kind === "core", "CORE BuybackExecuted toasts");
assert(coreBuy.title.includes("CORE"), "CORE title");
assert(coreBuy.body.includes("1 CORE"), `CORE burned body: ${coreBuy.body}`);
assert(coreBuy.id === canonicalEventKey(coreBuy.identity), "id is canonical identity");
assert(
  coreBuy.id === `${chainId}:${coreTx}:${1}:BuybackExecuted`,
  `canonical key ${coreBuy.id}`,
);

const coreBurn = toastFromLiveEvent(
  coreEv({ id: 12, name: "COREBurned", eventKind: "COREBurned", logIndex: 2, quoteIn: "0" }),
);
assert(coreBurn, "COREBurned toasts");
assert(coreBurn.id !== coreBuy.id, "BuybackExecuted and COREBurned are distinct logs");

assert(coreBuy.identity.chainId === chainId && coreBuy.identity.logIndex === 1 && coreBuy.identity.eventKind === "BuybackExecuted", "id binds all four identity fields");

const mergedKinds = pushVisibleToast(pushVisibleToast([], coreBuy), coreBurn);
assert(mergedKinds.length === 2, "distinct eventKinds on the same tx do not collapse");

const topA = toastFromLiveEvent(topEv({ logIndex: 4 }));
const topB = toastFromLiveEvent(topEv({ logIndex: 5, burned: "3000000000000000000" }));
assert(topA && topB, "two Top10Buy");
assert(topA.id !== topB.id, "same-tx distinct-log Top10Buy keys differ");
assert(pushVisibleToast([topA], topB).length === 2, "same-tx distinct-log Top10Buy do not collapse");

assert(toastFromLiveEvent({ type: "core", data: { name: "BuybackExecuted", tx: coreTx, confirmed: true } }) === null, "missing identity is not toasted");
assert(toastFromLiveEvent({ type: "burn", data: { name: "SelfBurnAccrued", tx: topTx, chainId, logIndex: 1, eventKind: "SelfBurnAccrued", confirmed: true } }) === null, "no SelfBurnAccrued toast");
assert(toastFromLiveEvent({ type: "burn", data: { name: "SelfBurnExecuted", tx: topTx, chainId, logIndex: 1, eventKind: "SelfBurnExecuted", burned: "1", confirmed: true } }) === null, "no SelfBurnExecuted toast");
assert(toastFromLiveEvent({ type: "burn", data: { name: "Burned", tx: topTx, token, chainId, logIndex: 1, eventKind: "Burned", confirmed: true } }) === null, "no holder burn toast");
assert(toastFromLiveEvent({ type: "top10", data: { epochId: "1", pot: "9" } }) === null, "no EpochSubmitted toast");
assert(toastFromLiveEvent({ type: "core", data: { name: "BuybackExecuted", tx: "", chainId, logIndex: 1, eventKind: "BuybackExecuted" } }) === null, "no toast without tx");
assert(toastFromLiveEvent(coreEv({ confirmed: false })) === null, "unconfirmed skipped");
assert(toastFromLiveEvent({ type: "trade", data: { tx: coreTx, chainId, logIndex: 1, eventKind: "Swap" } }) === null, "trades do not toast");
assert(toastFromLiveEvent({ type: "hello", data: { ok: true, last: 0, head: 10 } }) === null, "hello is not a toast");

assert(isLiveAfterHead(11, 10) === true, "id > head is live");
assert(isLiveAfterHead(10, 10) === false, "id == head is replay");
assert(isLiveAfterHead(undefined, 10) === false, "missing id is not live");

assert(identityFromLiveData({ tx: coreTx, chainId: "5042002", logIndex: "7", eventKind: "Top10Buy" })?.logIndex === 7, "identity coerces numbers");

const fifth = {
  ...topA,
  id: canonicalEventKey({ chainId, txHash: `0x${"aa".repeat(32)}`, logIndex: 9, eventKind: "Top10Buy" }),
  tx: `0x${"aa".repeat(32)}`,
  identity: { chainId, txHash: `0x${"aa".repeat(32)}`, logIndex: 9, eventKind: "Top10Buy" },
};
const stacked = pushVisibleToast(pushVisibleToast(pushVisibleToast(pushVisibleToast([coreBuy], topA), coreBurn), topB), fifth);
assert(stacked.length === 4, "cap at 4");
assert(!stacked.some((t) => t.id === coreBuy.id), "oldest dropped from the visible stack");

{
  let session = createLiveSession();
  session = applyHello(session, { head: 100, last: 0 });
  assert(session.cutoff === 100, "first hello sets cutoff");

  const hist = acceptLiveToast(session, coreEv({ id: 80 }));
  assert(hist.toast === null, "initial-session history suppressed");
  session = hist.session;

  const live = acceptLiveToast(session, coreEv({ id: 101 }));
  assert(live.toast?.id === coreBuy.id, "live CORE toasts");
  session = live.session;

  const again = acceptLiveToast(session, coreEv({ id: 102 }));
  assert(again.toast === null, "same canonical identity is not re-toasted while visible");
  session = again.session;

  const afterDismiss = acceptLiveToast(session, coreEv({ id: 103 }));
  assert(afterDismiss.toast === null, "seen-set survives dismiss / later SSE ids");
  session = afterDismiss.session;

  const otherLog = acceptLiveToast(session, topEv({ id: 104, logIndex: 4 }));
  assert(otherLog.toast, "distinct log still toasts");
  session = otherLog.session;
  const sibling = acceptLiveToast(session, topEv({ id: 105, logIndex: 5 }));
  assert(sibling.toast, "second same-tx Top10Buy toasts");
  assert(sibling.toast.id !== otherLog.toast?.id, "sibling identity differs");
  session = sibling.session;

  const reconnectHello = applyHello(session, { head: 200, last: 105 });
  assert(reconnectHello.cutoff === 100, "reconnect must not raise cutoff");
  session = reconnectHello;

  const replayHistory = acceptLiveToast(session, coreEv({ id: 50, logIndex: 9, eventKind: "BuybackExecuted", tx: `0x${"99".repeat(32)}` }));
  assert(replayHistory.toast === null, "reconnect history storm suppressed");
  session = replayHistory.session;

  const missed = acceptLiveToast(
    session,
    topEv({ id: 150, logIndex: 8, tx: `0x${"77".repeat(32)}` }),
  );
  assert(missed.toast, "event while disconnected is delivered on reconnect");
  session = missed.session;
  const missedDup = acceptLiveToast(
    session,
    topEv({ id: 150, logIndex: 8, tx: `0x${"77".repeat(32)}` }),
  );
  assert(missedDup.toast === null, "missed event delivered exactly once");

  let visible: LiveToast[] = [];
  for (const ev of [
    coreEv({ id: 201, logIndex: 20, tx: `0x${"a1".repeat(32)}` }),
    coreEv({ id: 202, logIndex: 21, tx: `0x${"a2".repeat(32)}` }),
    coreEv({ id: 203, logIndex: 22, tx: `0x${"a3".repeat(32)}` }),
    coreEv({ id: 204, logIndex: 23, tx: `0x${"a4".repeat(32)}` }),
    coreEv({ id: 205, logIndex: 24, tx: `0x${"a5".repeat(32)}` }),
  ]) {
    const out = acceptLiveToast(session, ev);
    session = out.session;
    if (out.toast) visible = pushVisibleToast(visible, out.toast);
  }
  assert(visible.length === 4, "visible window capped");
  const dropped = canonicalEventKey({ chainId, txHash: `0x${"a1".repeat(32)}`, logIndex: 20, eventKind: "BuybackExecuted" });
  assert(!visible.some((t) => t.id === dropped), "first log left the visible array");
  assert(hasSeenCanonical(session, dropped), "seen-set still holds the dropped log");
  const replayDropped = acceptLiveToast(session, coreEv({ id: 206, logIndex: 20, tx: `0x${"a1".repeat(32)}` }));
  assert(replayDropped.toast === null, "seen-set survives beyond the visible toast array");
}

{
  resetLiveSessionForTests();
  ingestLiveEvent({ type: "hello", data: { ok: true, last: 0, head: 10 } });
  const first = ingestLiveEvent(coreEv({ id: 11 }));
  assert(first, "module session toasts live");
  ingestLiveEvent(coreEv({ id: 12 }));
  assert(ingestLiveEvent(coreEv({ id: 13 })) === null, "module seen survives a second ingest");
  assert(hasSeenCanonical(getLiveSession(), first.id), "remount reads the same module seen-set");
}

assert(streamEndpoint("http://127.0.0.1:43148", 0) === "http://127.0.0.1:43148/stream", "first connect has no after");
assert(streamEndpoint("http://127.0.0.1:43148/", 105) === "http://127.0.0.1:43148/stream?after=105", "reconnect resumes after last id");

{
  const clock = createToastClock(1_000, 8_000);
  assert(clockExpired(clock, 8_999) === false, "not expired before remaining");
  assert(clockExpired(clock, 9_000) === true, "expired at remaining");
  const paused = pauseToastClock(clock, 3_000);
  assert(paused.running === false, "hover pauses");
  assert(paused.remainingMs === 6_000, "pause keeps leftover");
  assert(clockExpired(paused, 20_000) === false, "paused clock does not expire");
  const resumed = resumeToastClock(paused, 20_000);
  assert(resumed.running === true, "focus leave resumes");
  assert(clockExpired(resumed, 25_999) === false, "resumed leftover honored");
  assert(clockExpired(resumed, 26_000) === true, "resumed leftover expires");
}

assert(prefersReducedMotion({ matches: true }) === true, "reduced-motion on");
assert(prefersReducedMotion({ matches: false }) === false, "reduced-motion off");

const extra: LiveToast = coreBuy;
assert(extra.identity.eventKind === "BuybackExecuted", "identity retained");

console.log("live-toasts.test.ts: ok");
