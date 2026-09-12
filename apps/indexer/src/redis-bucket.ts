/**
 * Optional Redis atomic token-bucket via a tiny RESP client.
 * Durable source of truth remains Postgres/SQLite. Redis is a shared fast path.
 */
import { createConnection } from "node:net";

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  const u = new URL(url);
  return {
    host: u.hostname || "127.0.0.1",
    port: u.port ? Number(u.port) : 6379,
    password: u.password || undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : undefined,
  };
}

async function redisCall(url: string, args: string[]): Promise<string | number | null> {
  const cfg = parseRedisUrl(url);
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host: cfg.host, port: cfg.port });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("redis timeout"));
    }, 2_000);
    sock.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.on("data", (c) => chunks.push(c as Buffer));
    sock.on("connect", () => {
      const cmds: string[][] = [];
      if (cfg.password) cmds.push(["AUTH", cfg.password]);
      if (cfg.db != null && Number.isFinite(cfg.db)) cmds.push(["SELECT", String(cfg.db)]);
      cmds.push(args);
      let payload = "";
      for (const c of cmds) {
        payload += `*${c.length}\r\n`;
        for (const a of c) payload += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
      }
      sock.write(payload);
      sock.end();
    });
    sock.on("end", () => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8");
      const lines = text.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      if (last.startsWith("-")) reject(new Error(last.slice(1)));
      else if (last.startsWith(":")) resolve(Number(last.slice(1)));
      else if (last.startsWith("$") && last === "$-1") resolve(null);
      else resolve(last.startsWith("$") || last.startsWith("+") ? (lines[lines.length - 1] ?? last).replace(/^[+$]/, "") : last);
    });
  });
}

const LUA = `
local key = KEYS[1]
local cap = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local raw = redis.call('GET', key)
local tokens = cap
local ts = now
if raw then
  local sep = string.find(raw, '|')
  tokens = tonumber(string.sub(raw, 1, sep-1))
  ts = tonumber(string.sub(raw, sep+1))
end
tokens = math.min(cap, tokens + ((now - ts) * cap / window))
if tokens < 1 then
  redis.call('SET', key, string.format('%f|%d', tokens, now))
  return 0
end
tokens = tokens - 1
redis.call('SET', key, string.format('%f|%d', tokens, now))
return 1
`;

export async function redisConsumeToken(capacity: number, windowMs: number): Promise<boolean | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const r = await redisCall(url, ["EVAL", LUA, "1", "reactor:issuance", String(capacity), String(Date.now()), String(windowMs)]);
    return Number(r) === 1;
  } catch {
    return false;
  }
}
