import type { AddressFamily } from "./types.ts";

const EVM_TICKERS = new Set(["ETH", "ETC", "BNB", "MATIC", "AVAX", "FTM", "ARB", "OP", "BASE", "EVM"]);
const BTC_TICKERS = new Set(["XBT", "BTC"]);
const LTC_TICKERS = new Set(["LTC"]);
const BCH_TICKERS = new Set(["BCH"]);
const XRP_TICKERS = new Set(["XRP"]);
const XMR_TICKERS = new Set(["XMR"]);
const SOL_TICKERS = new Set(["SOL"]);
const TRX_TICKERS = new Set(["TRX"]);
const DASH_TICKERS = new Set(["DASH"]);
const ZEC_TICKERS = new Set(["ZEC"]);
const DOGE_TICKERS = new Set(["DOGE"]);

/** Multi-rail tickers: infer family from address shape, never collapse unlike shapes. */
const MULTI_RAIL_TICKERS = new Set(["USDT", "USDC", "DAI"]);

const TICKER_FAMILY: Record<string, AddressFamily> = Object.fromEntries([
  ...[...EVM_TICKERS].map((t) => [t, "evm" as const]),
  ...[...BTC_TICKERS].map((t) => [t, "btc" as const]),
  ...[...LTC_TICKERS].map((t) => [t, "ltc" as const]),
  ...[...BCH_TICKERS].map((t) => [t, "bch" as const]),
  ...[...XRP_TICKERS].map((t) => [t, "xrp" as const]),
  ...[...XMR_TICKERS].map((t) => [t, "xmr" as const]),
  ...[...SOL_TICKERS].map((t) => [t, "sol" as const]),
  ...[...TRX_TICKERS].map((t) => [t, "trx" as const]),
  ...[...DASH_TICKERS].map((t) => [t, "dash" as const]),
  ...[...ZEC_TICKERS].map((t) => [t, "zec" as const]),
  ...[...DOGE_TICKERS].map((t) => [t, "doge" as const]),
]);

const BASE58_BTC = /^[13][a-km-zA-HJ-NP-Z1-9]{24,34}$/;
const BECH32_BTC = /^(bc1|tb1|bcrt1)[ac-hj-np-z02-9]{6,87}$/i;
const BASE58_LTC = /^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BECH32_LTC = /^(ltc1)[ac-hj-np-z02-9]{6,87}$/i;
const XRP = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const TRX = /^T[1-9A-HJ-NP-Za-km-z]{25,34}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const XMR_STD = /^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/;
const XMR_HEX = /^[0-9a-fA-F]{64}$/;
const DASH = /^X[1-9A-HJ-NP-Za-km-z]{25,34}$/;
const ZEC_T = /^t[13][a-km-zA-HJ-NP-Z1-9]{33}$/;
const ZEC_Z = /^z[a-km-zA-HJ-NP-Z1-9]{90,}$/;
const DOGE = /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/;
const BCH_CASHADDR = /^(bitcoincash:)?[qp][a-z0-9]{40,120}$/i;

export function extractOfacTicker(idType: string): string | null {
  const t = idType.replace(/\u2013|\u2014/g, "-").replace(/\s+/g, " ").trim();
  const m = t.match(/^Digital Currency Address\s*-\s*([A-Za-z0-9]+)$/i);
  return m?.[1] ? m[1].toUpperCase() : null;
}

export function isEvmHex(raw: string): boolean {
  const s = raw.trim();
  const hex = /^0x/i.test(s) ? s.slice(2) : s;
  return /^[0-9a-fA-F]{40}$/.test(hex);
}

/** Canonical EVM identity: 20 bytes, lowercase hex, `evm:0x…`. Checksum casing is not identity. */
export function normalizeEvm(raw: string): string | null {
  const s = raw.trim();
  const hex = /^0x/i.test(s) ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) return null;
  return `evm:0x${hex.toLowerCase()}`;
}

export function normalizeBtc(raw: string): string | null {
  const s = raw.trim();
  if (BECH32_BTC.test(s)) return `btc:${s.toLowerCase()}`;
  if (BASE58_BTC.test(s)) return `btc:${s}`;
  return null;
}

export function normalizeLtc(raw: string): string | null {
  const s = raw.trim();
  if (BECH32_LTC.test(s)) return `ltc:${s.toLowerCase()}`;
  if (BASE58_LTC.test(s)) return `ltc:${s}`;
  return null;
}

export function normalizeBch(raw: string): string | null {
  const s = raw.trim();
  if (BCH_CASHADDR.test(s)) {
    const body = s.replace(/^bitcoincash:/i, "").toLowerCase();
    return `bch:bitcoincash:${body}`;
  }
  if (BASE58_BTC.test(s)) return `bch:${s}`;
  return null;
}

export function normalizeXrp(raw: string): string | null {
  const s = raw.trim();
  return XRP.test(s) ? `xrp:${s}` : null;
}

export function normalizeXmr(raw: string): string | null {
  const s = raw.trim();
  if (XMR_STD.test(s)) return `xmr:${s}`;
  if (XMR_HEX.test(s)) return `xmr:${s.toLowerCase()}`;
  return null;
}

export function normalizeSol(raw: string): string | null {
  const s = raw.trim();
  if (!SOL.test(s)) return null;
  if (isEvmHex(s) || BASE58_BTC.test(s) || TRX.test(s) || XRP.test(s)) return null;
  return `sol:${s}`;
}

export function normalizeTrx(raw: string): string | null {
  const s = raw.trim();
  return TRX.test(s) ? `trx:${s}` : null;
}

export function normalizeDash(raw: string): string | null {
  const s = raw.trim();
  return DASH.test(s) ? `dash:${s}` : null;
}

export function normalizeZec(raw: string): string | null {
  const s = raw.trim();
  if (ZEC_T.test(s) || ZEC_Z.test(s)) return `zec:${s}`;
  return null;
}

export function normalizeDoge(raw: string): string | null {
  const s = raw.trim();
  return DOGE.test(s) ? `doge:${s}` : null;
}

export function normalizeOther(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 256) return null;
  if (/^0x[0-9a-fA-F]+$/i.test(s) || /^[0-9a-fA-F]{16,}$/.test(s)) {
    const hex = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
    return `other:0x${hex.toLowerCase()}`;
  }
  return `other:${s}`;
}

const FAMILY_NORMALIZERS: Record<AddressFamily, (raw: string) => string | null> = {
  evm: normalizeEvm,
  btc: normalizeBtc,
  ltc: normalizeLtc,
  bch: normalizeBch,
  xrp: normalizeXrp,
  xmr: normalizeXmr,
  sol: normalizeSol,
  trx: normalizeTrx,
  dash: normalizeDash,
  zec: normalizeZec,
  doge: normalizeDoge,
  other: normalizeOther,
};

export function inferFamilyFromShape(raw: string): AddressFamily | null {
  if (isEvmHex(raw)) return "evm";
  if (normalizeBtc(raw)) return "btc";
  if (normalizeTrx(raw)) return "trx";
  if (normalizeXrp(raw)) return "xrp";
  if (normalizeXmr(raw)) return "xmr";
  if (normalizeLtc(raw)) return "ltc";
  if (normalizeBch(raw)) return "bch";
  if (normalizeDash(raw)) return "dash";
  if (normalizeZec(raw)) return "zec";
  if (normalizeDoge(raw)) return "doge";
  if (normalizeSol(raw)) return "sol";
  return null;
}

export function familyFromTicker(ticker: string, rawAddress: string): AddressFamily {
  const t = ticker.toUpperCase();
  if (MULTI_RAIL_TICKERS.has(t)) {
    return inferFamilyFromShape(rawAddress) ?? "other";
  }
  return TICKER_FAMILY[t] ?? inferFamilyFromShape(rawAddress) ?? "other";
}

export function canonicalKey(family: AddressFamily, raw: string): string | null {
  return FAMILY_NORMALIZERS[family](raw);
}

/**
 * Lookup keys for a user-supplied address.
 * Unlike families never share a key. An EVM hex does not produce a `btc:` key.
 */
export function candidateKeys(raw: string, family?: AddressFamily): string[] {
  const s = raw.trim();
  if (!s) return [];
  if (family) {
    const key = canonicalKey(family, s);
    return key ? [key] : [];
  }
  const keys = new Set<string>();
  const inferred = inferFamilyFromShape(s);
  if (inferred) {
    const key = canonicalKey(inferred, s);
    if (key) keys.add(key);
  }
  const other = normalizeOther(s);
  if (other && !inferred) keys.add(other);
  return [...keys];
}

export function evmDisplay(raw: string): string | null {
  const key = normalizeEvm(raw);
  return key ? key.slice("evm:".length) : null;
}
