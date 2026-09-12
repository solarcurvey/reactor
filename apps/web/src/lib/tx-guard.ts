/**
 * Wallet writes are never steered by creator metadata or indexer calldata.
 * Chain id must match the official deployment before any writeContract.
 */
import { getAddress } from "viem";
import { addresses, deployment } from "./addresses";
import { isEvmAddress, sanitizeAddress } from "./untrusted-metadata";

export type TxGuardCode = "CHAIN_MISMATCH" | "BAD_TARGET" | "BAD_RECIPIENT" | "BAD_HOP";

export class TxGuardError extends Error {
  readonly code: TxGuardCode;
  constructor(code: TxGuardCode, message: string) {
    super(message);
    this.name = "TxGuardError";
    this.code = code;
  }
}

export function officialChainId(): number {
  return deployment.chainId;
}

export function isOfficialChain(walletChainId: number | undefined | null): boolean {
  return walletChainId != null && walletChainId === officialChainId();
}

export function assertOfficialChain(walletChainId: number | undefined | null): number {
  const expected = officialChainId();
  if (!isOfficialChain(walletChainId)) {
    throw new TxGuardError(
      "CHAIN_MISMATCH",
      `Wrong network. Wallet is ${walletChainId ?? "disconnected"}; expected chain ${expected}.`,
    );
  }
  return expected;
}

export function chainMismatchMessage(walletChainId: number | undefined | null): string {
  return `Wrong network. Wallet is ${walletChainId ?? "disconnected"}; expected chain ${officialChainId()}. Writes are blocked.`;
}

function checksum(addr: `0x${string}`): `0x${string}` {
  return getAddress(addr);
}

/** Official protocol + quote contracts. Per-token curve/token are passed as extras after sanitizeAddress. */
export function officialWriteTargets(): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(addresses)) {
    if (typeof value === "string" && isEvmAddress(value)) out.add(value.toLowerCase());
  }
  return out;
}

export function requireAddress(raw: unknown, label: string): `0x${string}` {
  const addr = sanitizeAddress(raw);
  if (!addr) {
    throw new TxGuardError("BAD_TARGET", `${label} is not a checksum address.`);
  }
  return checksum(addr);
}

export function assertWriteTarget(to: unknown, extras: readonly `0x${string}`[] = []): `0x${string}` {
  const addr = requireAddress(to, "Write target");
  const allowed = officialWriteTargets();
  for (const extra of extras) {
    const e = sanitizeAddress(extra);
    if (e) allowed.add(e.toLowerCase());
  }
  if (!allowed.has(addr.toLowerCase())) {
    throw new TxGuardError("BAD_TARGET", "Write target is not an official contract or this market's token/curve/quote.");
  }
  return addr;
}

export function assertWalletRecipient(connected: unknown): `0x${string}` {
  const addr = sanitizeAddress(connected);
  if (!addr) {
    throw new TxGuardError("BAD_RECIPIENT", "Connect a wallet. Recipient cannot come from token metadata.");
  }
  return checksum(addr);
}

/**
 * Indexer quote `tx.to` / `tx.data` are never broadcast.
 * Callers must build calldata from official ABIs + local args.
 */
export function discardIndexerBroadcastTx(_tx: { to?: string; data?: string } | null | undefined): null {
  return null;
}

export type RouteHop = {
  adapter: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  minOut: bigint;
  data: `0x${string}`;
};

export function allowlistedAdapters(): Set<string> {
  const out = new Set<string>();
  for (const raw of [addresses.V4Adapter, addresses.ProtocolV4Adapter, addresses.UserRouteExecutor]) {
    if (typeof raw === "string" && isEvmAddress(raw)) out.add(raw.toLowerCase());
  }
  return out;
}

export function sanitizeRouteHops(hops: unknown): RouteHop[] {
  if (hops == null) return [];
  if (!Array.isArray(hops)) {
    throw new TxGuardError("BAD_HOP", "Route hops must be an array.");
  }
  const adapters = allowlistedAdapters();
  const out: RouteHop[] = [];
  for (const raw of hops) {
    if (!raw || typeof raw !== "object") {
      throw new TxGuardError("BAD_HOP", "Route hop is not an object.");
    }
    const hop = raw as Record<string, unknown>;
    const adapter = requireAddress(hop.adapter, "Hop adapter");
    if (adapters.size > 0 && !adapters.has(adapter.toLowerCase())) {
      throw new TxGuardError("BAD_HOP", "Route hop adapter is not allowlisted.");
    }
    const tokenIn = requireAddress(hop.tokenIn, "Hop tokenIn");
    const tokenOut = requireAddress(hop.tokenOut, "Hop tokenOut");
    const data = typeof hop.data === "string" && /^0x[0-9a-fA-F]*$/.test(hop.data) ? (hop.data as `0x${string}`) : null;
    if (!data) throw new TxGuardError("BAD_HOP", "Route hop data is not hex.");
    let minOut = 0n;
    try {
      minOut = typeof hop.minOut === "bigint" ? hop.minOut : BigInt(String(hop.minOut ?? 0));
    } catch {
      throw new TxGuardError("BAD_HOP", "Route hop minOut is not an integer.");
    }
    out.push({ adapter, tokenIn, tokenOut, minOut, data });
  }
  return out;
}

export type SpenderKind = "router" | "curve" | "userRoute" | "factory" | "token";

export type TradeWriteContext = {
  chainId: number | undefined | null;
  connected: unknown;
  token: unknown;
  quote: unknown;
  curve?: unknown;
  kind: SpenderKind;
  indexerTx?: { to?: string; data?: string } | null;
  metadata?: { name?: unknown; image?: unknown; website?: unknown; twitter?: unknown; telegram?: unknown };
};

/**
 * Resolve the only legal `to` / recipient for a wallet write.
 * Creator name / image / website / socials cannot become the target.
 * Quote-API `tx` is discarded.
 */
export function resolveTradeWrite(ctx: TradeWriteContext): {
  to: `0x${string}`;
  recipient: `0x${string}`;
  token: `0x${string}`;
  quote: `0x${string}`;
  curve: `0x${string}` | "";
  indexerTx: null;
} {
  assertOfficialChain(ctx.chainId);
  const indexerTx = discardIndexerBroadcastTx(ctx.indexerTx);
  const token = requireAddress(ctx.token, "Token");
  const quote = requireAddress(ctx.quote, "Quote");
  const curve = ctx.curve ? requireAddress(ctx.curve, "Curve") : ("" as const);
  const extras = [token, quote, ...(curve ? [curve] : [])];
  const recipient = assertWalletRecipient(ctx.connected);

  const metaValues = [
    ctx.metadata?.name,
    ctx.metadata?.image,
    ctx.metadata?.website,
    ctx.metadata?.twitter,
    ctx.metadata?.telegram,
  ];
  for (const raw of metaValues) {
    if (typeof raw !== "string" || !raw) continue;
    const asAddr = sanitizeAddress(raw);
    if (asAddr && (asAddr.toLowerCase() === token.toLowerCase() || (curve && asAddr.toLowerCase() === curve.toLowerCase()))) {
      continue;
    }
    if (asAddr && officialWriteTargets().has(asAddr.toLowerCase()) === false) {
      /* metadata looking like an address is ignored — we never use it as `to` */
    }
  }

  let to: `0x${string}`;
  if (ctx.kind === "router") to = assertWriteTarget(addresses.ReactorRouter);
  else if (ctx.kind === "userRoute") to = assertWriteTarget(addresses.UserRouteExecutor);
  else if (ctx.kind === "factory") to = assertWriteTarget(addresses.ReactorFactory);
  else if (ctx.kind === "curve") {
    if (!curve) throw new TxGuardError("BAD_TARGET", "Curve address missing.");
    to = assertWriteTarget(curve, extras);
  } else if (ctx.kind === "token") to = assertWriteTarget(token, extras);
  else throw new TxGuardError("BAD_TARGET", "Unknown spender kind.");

  for (const raw of metaValues) {
    if (typeof raw === "string" && raw.toLowerCase() === to.toLowerCase() && raw.toLowerCase() !== token.toLowerCase()) {
      throw new TxGuardError("BAD_TARGET", "Refusing a write target that equals creator metadata.");
    }
  }

  return { to, recipient, token, quote, curve, indexerTx };
}
