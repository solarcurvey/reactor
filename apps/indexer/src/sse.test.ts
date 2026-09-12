import { streamHello, streamResumeAfter, SseHub } from "./sse.ts";

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
hub.publish({ type: "core", data: { tx: "0x3", name: "COREBurned", confirmed: true } });
assert(hub.headId === 3, "head advances with publish");

const replayHead = streamHello(0, hub.headId);
assert(replayHead.head === 3, "connect hello reports current head");
assert(replayHead.head > replayHead.last, "fresh client last < head so replay is not live");

assert(streamResumeAfter("/stream", "") === 0, "fresh attach after=0");
assert(streamResumeAfter("/stream?after=2", "") === 2, "query after");
assert(streamResumeAfter("/stream", "2") === 2, "Last-Event-ID");
assert(streamResumeAfter("/stream?after=2", "5") === 5, "max(after, Last-Event-ID)");
assert(streamResumeAfter("/stream?after=9", "3") === 9, "after wins when larger");

const reconnect = streamHello(2, hub.headId);
assert(reconnect.last === 2, "reconnect last is resume cursor");
assert(reconnect.head === 3, "reconnect hello.head is current hub — clients must not raise cutoff");

console.log("sse.test.ts: ok");
