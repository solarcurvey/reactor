export const QA_INJECT_KINDS = [
  "indexer",
  "rpc",
  "quote",
  "quote-429",
  "quote-413",
  "quote-5xx",
  "quote-stale",
  "quote-expired",
  "quote-noroute",
  "pricing",
  "upload",
  "sse",
  "empty",
  "token-invalid",
  "ticker-invalid",
  "wallet-reject",
  "wallet-revert",
] as const;
export type QaInjectKind = (typeof QA_INJECT_KINDS)[number];

export const QA_STATES = [
  "loading",
  "empty",
  "search",
  "filter-bonding",
  "ticker-reserved",
  "ticker-available",
  "upload-ok",
  "standard",
  "rewards",
  "devbuy",
  "tx-pending",
  "tx-confirmed",
  "tx-reverted",
  "wallet-menu",
  "wallet-connected",
  "dialog",
  "toast",
] as const;
export type QaState = (typeof QA_STATES)[number];

export const FAILURE_COPY: Record<QaInjectKind, { title: string; body: string }> = {
  indexer: {
    title: "Indexer unavailable",
    body: "Market board, charts, and tape come from the indexer. Onchain balances still settle. Retry when GET /health is ok.",
  },
  rpc: {
    title: "RPC unavailable",
    body: "Could not read the chain. Connect to chain 5042002 (Anvil locally). Onchain truth is unchanged.",
  },
  quote: {
    title: "Quote unavailable",
    body: "POST /quote failed. No ticket — never minOut 0 or 1. Size may exceed remaining depth, or the quoter is down.",
  },
  "quote-429": {
    title: "Quote rate-limited",
    body: "POST /quote returned 429. Wait and retry. No ticket was issued.",
  },
  "quote-413": {
    title: "Quote body rejected",
    body: "POST /quote returned 413. Public JSON is capped at 16KiB / 64KiB hard max. No ticket.",
  },
  "quote-5xx": {
    title: "Quote service error",
    body: "POST /quote returned 5xx. No ticket — never minOut 0 or 1.",
  },
  "quote-stale": {
    title: "Quote stale",
    body: "This ticket is older than 30s. Request a new quote before confirm.",
  },
  "quote-expired": {
    title: "Quote expired",
    body: "The quote ticket expired. Request a new quote. No leftover calldata.",
  },
  "quote-noroute": {
    title: "No route",
    body: "Preview failed or no official path. Unavailable — never minOut 0 or 1.",
  },
  pricing: {
    title: "Pricing signer unavailable",
    body: "LaunchAuthorization fail-closed. SIGNER_STORE_UNAVAILABLE — no skip consume, no unsigned launch.",
  },
  upload: {
    title: "Upload failed",
    body: "Media upload failed. No StoredMedia, no base64 onchain. Retry the file (≤2MB).",
  },
  sse: {
    title: "Live feed disconnected",
    body: "SSE dropped. Reconnect uses the same event id — the UI must not duplicate toasts.",
  },
  empty: {
    title: "No indexed markets",
    body: "GET /markets returned zero rows. This is empty data, not an indexer outage.",
  },
  "token-invalid": {
    title: "Token not found",
    body: "This address is not a factory launch on the connected chain.",
  },
  "ticker-invalid": {
    title: "Invalid ticker",
    body: "Ticker failed normalize / reserve rules. 24h lock is unchanged.",
  },
  "wallet-reject": {
    title: "Wallet rejected",
    body: "The wallet rejected the request (4001). No transaction was sent.",
  },
  "wallet-revert": {
    title: "Transaction reverted",
    body: "The wallet submitted but the transaction reverted. Incomplete fills revert. No ticket leftover.",
  },
};

/** Compiled-in only. Real prod builds omit NEXT_PUBLIC_QA_INJECT / REVIEW_FIXTURES. */
export function qaInjectEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REVIEW_FIXTURES === "1" || process.env.NEXT_PUBLIC_QA_INJECT === "1";
}

export function parseQaInject(search: string): QaInjectKind | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const value = (params.get("inject") ?? "").toLowerCase();
  return (QA_INJECT_KINDS as readonly string[]).includes(value) ? (value as QaInjectKind) : null;
}

export function parseQaState(search: string): QaState | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const value = (params.get("state") ?? "").toLowerCase();
  return (QA_STATES as readonly string[]).includes(value) ? (value as QaState) : null;
}

export function currentQaInject(): QaInjectKind | null {
  if (!qaInjectEnabled() || typeof window === "undefined") return null;
  return parseQaInject(window.location.search);
}

export class ServiceUnavailableError extends Error {
  readonly kind: QaInjectKind;

  constructor(kind: QaInjectKind, message = FAILURE_COPY[kind].body) {
    super(message);
    this.name = "ServiceUnavailableError";
    this.kind = kind;
  }
}

export function isServiceUnavailable(err: unknown): err is ServiceUnavailableError {
  return err instanceof ServiceUnavailableError;
}

export function isQuoteInject(
  kind: QaInjectKind | null,
): kind is "quote" | "quote-429" | "quote-413" | "quote-5xx" | "quote-stale" | "quote-expired" | "quote-noroute" {
  return (
    kind === "quote" ||
    kind === "quote-429" ||
    kind === "quote-413" ||
    kind === "quote-5xx" ||
    kind === "quote-stale" ||
    kind === "quote-expired" ||
    kind === "quote-noroute"
  );
}
