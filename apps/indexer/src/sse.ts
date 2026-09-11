import type { IncomingMessage, ServerResponse } from "node:http";

export type SseEvent = {
  type: string;
  data: unknown;
};

type Client = { res: ServerResponse; lastId: number };

export class SseHub {
  private clients = new Set<Client>();
  private buf: Array<{ id: number; ev: SseEvent }> = [];
  private nextId = 1;

  publish(ev: SseEvent) {
    const id = this.nextId++;
    this.buf.push({ id, ev });
    if (this.buf.length > 400) this.buf.splice(0, this.buf.length - 400);
    const payload = `id: ${id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`;
    for (const c of this.clients) {
      try {
        c.res.write(payload);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  attach(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    const last = Number(req.headers["last-event-id"] ?? 0);
    const client: Client = { res, lastId: last };
    this.clients.add(client);
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, last })}\n\n`);
    for (const row of this.buf) {
      if (row.id > last) {
        res.write(`id: ${row.id}\nevent: ${row.ev.type}\ndata: ${JSON.stringify(row.ev.data)}\n\n`);
      }
    }
    const ping = setInterval(() => {
      try {
        res.write(`event: ping\ndata: ${Date.now()}\n\n`);
      } catch {
        clearInterval(ping);
      }
    }, 15_000);
    req.on("close", () => {
      clearInterval(ping);
      this.clients.delete(client);
    });
  }

  get size() {
    return this.clients.size;
  }
}
