/** Shared ticker normalize — same rules as `contracts/src/libraries/Ticker.sol`. */

export const MAX_TICKER_LEN = 10;
export const TICKER_LOCK_SECONDS = 24 * 60 * 60;
export const RESERVED_TICKERS = ["CORE", "REACTOR", "USDC", "ZEC", "WBTC", "EURC"] as const;

export class BadTicker extends Error {
  constructor(message = "BadTicker") {
    super(message);
    this.name = "BadTicker";
  }
}

export function normalizeTicker(raw: string): string {
  if (typeof raw !== "string") throw new BadTicker();
  const out: string[] = [];
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 127) throw new BadTicker("no Unicode");
    let c = code;
    if (c >= 0x61 && c <= 0x7a) c -= 32;
    const ok = (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39);
    if (!ok) throw new BadTicker("A–Z / 0–9 only");
    out.push(String.fromCharCode(c));
  }
  if (out.length === 0 || out.length > MAX_TICKER_LEN) throw new BadTicker("length");
  return out.join("");
}

export function tryNormalizeTicker(raw: string): { ok: true; ticker: string } | { ok: false; reason: string } {
  try {
    return { ok: true, ticker: normalizeTicker(raw) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "BadTicker" };
  }
}

export function isReservedTicker(raw: string): boolean {
  try {
    return (RESERVED_TICKERS as readonly string[]).includes(normalizeTicker(raw));
  } catch {
    return false;
  }
}

export function tickerHash(canonical: string): `0x${string}` {
  // keccak256 is applied onchain; FE/BE compare the canonical string.
  return `0x${Buffer.from(canonical, "utf8").toString("hex").padEnd(64, "0")}` as `0x${string}`;
}
