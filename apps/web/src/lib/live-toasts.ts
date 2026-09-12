import { formatUnitsSafe, shortAddress } from "./utils.ts";

export const LIVE_TOAST_LIMIT = 4;
export const LIVE_TOAST_MS = 8_000;

export type LiveStreamEvent = {
  type: string;
  data: Record<string, unknown>;
  id?: number;
};

export type LiveToastKind = "core" | "top10";

export type LiveToast = {
  id: string;
  kind: LiveToastKind;
  title: string;
  body: string;
  tx: string;
};

const EXEC_CORE = new Set(["BuybackExecuted", "COREBurned"]);

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function rawAmt(v: unknown): bigint {
  try {
    const s = str(v).trim();
    if (!s || s === "0") return 0n;
    return BigInt(s);
  } catch {
    return 0n;
  }
}

export function isLiveAfterHead(eventId: number | undefined, head: number): boolean {
  if (!Number.isFinite(head)) return false;
  const id = Number(eventId ?? 0);
  return Number.isFinite(id) && id > head;
}

export function toastDedupeKey(kind: LiveToastKind, tx: string, token = ""): string {
  const t = tx.toLowerCase();
  if (kind === "core") return `core:${t}`;
  return `top10:${t}:${token.toLowerCase()}`;
}

function formatCoreBody(data: Record<string, unknown>): string {
  const burned = rawAmt(data.coreOut ?? data.amount);
  const spent = rawAmt(data.quoteIn);
  const parts: string[] = [];
  if (burned > 0n) parts.push(`${formatUnitsSafe(burned, 18, 4)} CORE burned`);
  if (spent > 0n) parts.push(`${formatUnitsSafe(spent, 6, 4)} quote in`);
  return parts.length ? parts.join(" · ") : "Keeper buy+burn landed onchain.";
}

function formatTop10Body(data: Record<string, unknown>): string {
  const burned = rawAmt(data.burned);
  const usdc = rawAmt(data.amount ?? data.usdcIn);
  const token = str(data.token);
  const parts: string[] = [];
  if (burned > 0n) parts.push(`${formatUnitsSafe(burned, 18, 4)} burned`);
  if (usdc > 0n) parts.push(`${formatUnitsSafe(usdc, 6, 4)} USDC`);
  if (token) parts.push(shortAddress(token));
  return parts.length ? parts.join(" · ") : "Top-10 buy+burn landed onchain.";
}

/** Map a post-commit SSE event to a CORE / Top-10 toast. Accruals and epoch submits are ignored. */
export function toastFromLiveEvent(ev: LiveStreamEvent): LiveToast | null {
  const data = ev.data ?? {};
  const tx = str(data.tx).trim();
  if (!tx || tx === "0x" || tx.length < 10) return null;
  if (data.confirmed === false) return null;

  if (ev.type === "core") {
    const name = str(data.name);
    if (name && !EXEC_CORE.has(name)) return null;
    if (!name && rawAmt(data.coreOut ?? data.amount) === 0n && rawAmt(data.quoteIn) === 0n) return null;
    return {
      id: toastDedupeKey("core", tx),
      kind: "core",
      title: "CORE buy+burn confirmed",
      body: formatCoreBody(data),
      tx,
    };
  }

  if (ev.type === "burn" && str(data.name) === "Top10Buy") {
    const token = str(data.token);
    return {
      id: toastDedupeKey("top10", tx, token),
      kind: "top10",
      title: "Top-10 buy+burn confirmed",
      body: formatTop10Body(data),
      tx,
    };
  }

  return null;
}

export function mergeLiveToasts(existing: LiveToast[], next: LiveToast): LiveToast[] {
  const idx = existing.findIndex((t) => t.id === next.id);
  if (idx >= 0) {
    const copy = existing.slice();
    copy[idx] = { ...copy[idx], ...next };
    return copy;
  }
  return [...existing, next].slice(-LIVE_TOAST_LIMIT);
}
