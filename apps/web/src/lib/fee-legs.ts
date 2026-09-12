import { addresses } from "./addresses";
import { formatUnitsSafe } from "./utils";

/** Quote-ticket fee leg as returned by `POST /quote` (plus optional per-leg denom fields). */
export type TicketFeeLeg = {
  reactorOfficial: boolean;
  protocolFeeBps: number;
  venue: string;
  tokenIn?: string;
  tokenOut?: string;
  notionalQuote?: string;
  holders?: string;
  flywheel?: string;
  core?: string;
  feeExempt?: boolean;
  quoteToken?: string;
  quoteDecimals?: number;
  quoteSymbol?: string;
};

export type QuoteDenom = {
  token: string;
  symbol: string;
  decimals: number;
};

export type FormattedFeeLeg = {
  venue: string;
  protocolFeeBps: number;
  tokenIn?: string;
  tokenOut?: string;
  quoteToken: string;
  quoteSymbol: string;
  quoteDecimals: number;
  decimalsKnown: boolean;
  holders: bigint;
  flywheel: bigint;
  core: bigint;
  notional: bigint;
  holdersText: string;
  flywheelText: string;
  coreText: string;
  notionalText: string;
  hopLabel: string;
  line: string;
};

export type OfficialFeeDisclosureView = {
  officialCount: number;
  legs: FormattedFeeLeg[];
  /** Set only when every official leg shares one quote token and the same decimals. */
  combined: {
    quoteToken: string;
    quoteSymbol: string;
    quoteDecimals: number;
    holders: bigint;
    flywheel: bigint;
    core: bigint;
  } | null;
  heterogeneous: boolean;
  headline: string;
  bodyLines: string[];
};

function norm(addr?: string): string {
  return (addr ?? "").toLowerCase();
}

function shortHop(addr?: string): string {
  if (!addr) return "?";
  return addr.slice(0, 6);
}

/** Registered protocol quotes used when the live registry / ticket has not loaded. */
export function protocolQuoteFallbacks(): QuoteDenom[] {
  const out: QuoteDenom[] = [];
  if (addresses.USDC) out.push({ token: addresses.USDC, symbol: "USDC", decimals: 6 });
  if (addresses.ZEC) out.push({ token: addresses.ZEC, symbol: "ZEC", decimals: 8 });
  if (addresses.BTC) out.push({ token: addresses.BTC, symbol: "BTC", decimals: 8 });
  return out;
}

export function buildQuoteDenomCatalog(sources: {
  quotes?: Array<{ token: string; symbol?: string; decimals?: number }>;
  terminal?: { token: string; symbol?: string; decimals?: number };
  extras?: QuoteDenom[];
}): Map<string, QuoteDenom> {
  const catalog = new Map<string, QuoteDenom>();
  const add = (token?: string, symbol?: string, decimals?: number) => {
    const key = norm(token);
    if (!key || !key.startsWith("0x")) return;
    const prev = catalog.get(key);
    catalog.set(key, {
      token: key,
      symbol: symbol && symbol.length ? symbol : (prev?.symbol ?? shortHop(token)),
      decimals: decimals != null && Number.isFinite(decimals) ? Number(decimals) : (prev?.decimals ?? 18),
    });
  };
  for (const e of sources.extras ?? []) add(e.token, e.symbol, e.decimals);
  for (const q of sources.quotes ?? []) add(q.token, q.symbol, q.decimals);
  if (sources.terminal) add(sources.terminal.token, sources.terminal.symbol, sources.terminal.decimals);
  return catalog;
}

/**
 * Quote asset the 3.5% is charged on — same rule as `hopQuoteNotional`:
 * quote→token uses tokenIn; token→quote uses tokenOut; two quotes follow route side.
 */
export function feeLegQuoteToken(
  leg: TicketFeeLeg,
  quoteTokens: Set<string>,
  side?: "buy" | "sell",
): string {
  if (leg.quoteToken) return norm(leg.quoteToken);
  const tin = norm(leg.tokenIn);
  const tout = norm(leg.tokenOut);
  const inQ = Boolean(tin) && quoteTokens.has(tin);
  const outQ = Boolean(tout) && quoteTokens.has(tout);
  if (inQ && !outQ) return tin;
  if (outQ && !inQ) return tout;
  if (side === "sell") return tout || tin;
  return tin || tout;
}

export function officialFeeLegs(legs: TicketFeeLeg[]): TicketFeeLeg[] {
  return legs.filter((f) => f.reactorOfficial && !f.feeExempt);
}

function formatAmount(raw: bigint, decimals: number, known: boolean): string {
  if (!known) return raw.toString();
  return formatUnitsSafe(raw, decimals, 6);
}

export function formatOfficialFeeDisclosure(
  legs: TicketFeeLeg[],
  catalog: Map<string, QuoteDenom>,
  opts?: {
    side?: "buy" | "sell";
    reactorFeeCount?: number;
    aggregateImpactBps?: number;
  },
): OfficialFeeDisclosureView {
  const official = officialFeeLegs(legs);
  const quoteTokens = new Set(catalog.keys());
  const formatted: FormattedFeeLeg[] = official.map((f) => {
    const quoteToken = feeLegQuoteToken(f, quoteTokens, opts?.side);
    const meta = catalog.get(quoteToken);
    const decimalsKnown = f.quoteDecimals != null || Boolean(meta);
    const quoteDecimals = f.quoteDecimals ?? meta?.decimals ?? 18;
    const quoteSymbol = f.quoteSymbol || meta?.symbol || shortHop(quoteToken);
    const holders = BigInt(f.holders ?? "0");
    const flywheel = BigInt(f.flywheel ?? "0");
    const core = BigInt(f.core ?? "0");
    const notional = BigInt(f.notionalQuote ?? "0");
    const hopLabel =
      f.tokenIn && f.tokenOut ? `${shortHop(f.tokenIn)}→${shortHop(f.tokenOut)}` : "";
    const holdersText = formatAmount(holders, quoteDecimals, decimalsKnown);
    const flywheelText = formatAmount(flywheel, quoteDecimals, decimalsKnown);
    const coreText = formatAmount(core, quoteDecimals, decimalsKnown);
    const notionalText = formatAmount(notional, quoteDecimals, decimalsKnown);
    const split = decimalsKnown
      ? `${holdersText} ${quoteSymbol} Rewards/Standard · ${flywheelText} ${quoteSymbol} Top-10 · ${coreText} ${quoteSymbol} CORE · notional ${notionalText} ${quoteSymbol}`
      : `split in ${quoteSymbol} (decimals unknown — not formatted)`;
    const line = `${f.venue} ${f.protocolFeeBps / 100}%${hopLabel ? ` ${hopLabel}` : ""}: ${split}`;
    return {
      venue: f.venue,
      protocolFeeBps: f.protocolFeeBps,
      tokenIn: f.tokenIn,
      tokenOut: f.tokenOut,
      quoteToken,
      quoteSymbol,
      quoteDecimals,
      decimalsKnown,
      holders,
      flywheel,
      core,
      notional,
      holdersText,
      flywheelText,
      coreText,
      notionalText,
      hopLabel,
      line,
    };
  });

  const denomKeys = new Set(formatted.map((l) => `${l.quoteToken}:${l.quoteDecimals}`));
  const heterogeneous = denomKeys.size > 1;
  const combined =
    !heterogeneous && formatted.length > 0 && formatted.every((l) => l.decimalsKnown)
      ? {
          quoteToken: formatted[0]!.quoteToken,
          quoteSymbol: formatted[0]!.quoteSymbol,
          quoteDecimals: formatted[0]!.quoteDecimals,
          holders: formatted.reduce((s, l) => s + l.holders, 0n),
          flywheel: formatted.reduce((s, l) => s + l.flywheel, 0n),
          core: formatted.reduce((s, l) => s + l.core, 0n),
        }
      : null;

  const count = opts?.reactorFeeCount ?? official.length;
  const impact = opts?.aggregateImpactBps ?? 0;
  const impactBit = impact > 0 ? ` · ${impact / 100}% compound` : "";
  const countBit = `${count} official leg${count === 1 ? "" : "s"}`;
  const headline = heterogeneous
    ? `Quote ticket fees (${countBit}${impactBit}) — each hop in its own quote; amounts are not summed`
    : combined
      ? `Quote ticket fees (${countBit}${impactBit})`
      : official.length === 0
        ? ""
        : `Quote ticket fees (${countBit}${impactBit})`;

  return {
    officialCount: official.length,
    legs: formatted,
    combined,
    heterogeneous,
    headline,
    bodyLines: formatted.map((l) => l.line),
  };
}
