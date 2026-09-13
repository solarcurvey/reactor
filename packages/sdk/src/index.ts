/**
 * @reactor/sdk — public client for third-party terminals.
 * Talks to the indexer public/partner API. No keys. No KYC.
 */
export {
  normalizeTicker,
  tryNormalizeTicker,
  isReservedTicker,
  MAX_TICKER_LEN,
  RESERVED_TICKERS,
  evaluateAdmission,
  serializeLaunchAuth,
  INSTANT_CURVE_V1,
  FAIR_V1,
} from "../../reactor/src/index.ts";

export type ReactorClientOpts = {
  baseUrl: string;
  apiKey?: string;
};

export class ReactorClient {
  constructor(private opts: ReactorClientOpts) {}

  async ticker(raw: string) {
    const r = await fetch(`${this.opts.baseUrl}/ticker/${encodeURIComponent(raw)}`);
    return r.json();
  }

  async markets(q?: {
    q?: string;
    stage?: string;
    quote?: string;
    sort?: "new" | "vol" | "price";
    limit?: number;
    offset?: string;
    cursor_ts?: string;
    cursor_token?: string;
  }) {
    const u = new URL("/markets", this.opts.baseUrl);
    if (q?.q) u.searchParams.set("q", q.q);
    if (q?.stage) u.searchParams.set("stage", q.stage);
    if (q?.quote) u.searchParams.set("quote", q.quote);
    if (q?.sort) u.searchParams.set("sort", q.sort);
    if (q?.limit) u.searchParams.set("limit", String(q.limit));
    if (q?.offset) u.searchParams.set("offset", q.offset);
    if (q?.cursor_ts != null) u.searchParams.set("cursor_ts", q.cursor_ts);
    if (q?.cursor_token) u.searchParams.set("cursor_token", q.cursor_token);
    const r = await fetch(u);
    return r.json();
  }

  async market(token: string) {
    const r = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/markets/${token}`);
    return r.json();
  }

  async quoteAssets() {
    const r = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/quote-assets`);
    return r.json();
  }

  async tokenPage(token: string, interval = "5m") {
    const u = new URL(`/page/token/${token}`, this.opts.baseUrl);
    u.searchParams.set("interval", interval);
    const r = await fetch(u);
    return r.json();
  }

  async admit(body: Record<string, unknown>) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) headers["x-partner-key"] = this.opts.apiKey;
    const r = await fetch(`${this.opts.baseUrl}/launch/admit`, { method: "POST", headers, body: JSON.stringify(body) });
    return r.json();
  }

  async authorize(body: Record<string, unknown>) {
    const r = await fetch(`${this.opts.baseUrl}/launch/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  stream(onEvent: (ev: { type: string; data: unknown }) => void): EventSource {
    const es = new EventSource(`${this.opts.baseUrl}/stream`);
    const types = ["trade", "launch", "bonding", "graduation", "rewards", "burn", "top10", "core", "hello"] as const;
    for (const type of types) {
      es.addEventListener(type, (m) => {
        try {
          onEvent({ type, data: JSON.parse(String((m as MessageEvent).data)) });
        } catch {
          /* ignore */
        }
      });
    }
    return es;
  }
}
