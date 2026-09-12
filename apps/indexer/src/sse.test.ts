import { streamHello, SseHub } from "./sse.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const hello = streamHello(0, 12);
assert(hello.ok === true, "hello ok");
assert(hello.last === 0, "hello last is Last-Event-ID");
assert(hello.head === 12, "hello head is buffer head at attach");

const hub = new SseHub();
assert(hub.headId === 0, "empty hub head is 0");
hub.publish({ type: "core", data: { tx: "0x1", name: "BuybackExecuted", confirmed: true } });
hub.publish({ type: "burn", data: { name: "Top10Buy", tx: "0x2", confirmed: true } });
assert(hub.headId === 2, "head advances with publish");

const replayHead = streamHello(0, hub.headId);
assert(replayHead.head === 2, "connect hello reports current head");
assert(replayHead.head > replayHead.last, "fresh client last < head so replay is not live");

console.log("sse.test.ts: ok");
