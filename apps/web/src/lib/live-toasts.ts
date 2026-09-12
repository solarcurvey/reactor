import { formatUnitsSafe, shortAddress } from "./utils.ts";

export const LIVE_TOAST_LIMIT = 4;
export const LIVE_TOAST_MS = 8_000;

export type LiveStreamEvent = {
  type: string;
  data: Record<string, unknown>;
  id?: number;
};

export type LiveToastKind = "core" | "top10";

export type LogIdentity = {
  chainId: number;
  txHash: string;
  logIndex: number;
  eventKind: string;
};

export type LiveToast = {
  id: string;
  kind: LiveToastKind;
  title: string;
  body: string;
  tx: string;
  identity: LogIdentity;
};

export type LiveSession = {
  /** First-connect `hello.head`. Never reset on reconnect. */
  cutoff: number | null;
  lastSseId: number;
  seen: Set<string>;
};

export type ToastClock = {
  remainingMs: number;
  running: boolean;
  startedAt: number | null;
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

/** Canonical `(chainId, txHash, logIndex, eventKind)` — not tx-only. */
export function canonicalEventKey(id: LogIdentity): string {
  return `${id.chainId}:${id.txHash.toLowerCase()}:${id.logIndex}:${id.eventKind}`;
}

export function identityFromLiveData(data: Record<string, unknown>, fallbackKind = ""): LogIdentity | null {
  const txHash = str(data.tx ?? data.txHash).trim();
  const eventKind = str(data.eventKind ?? data.name ?? fallbackKind);
  const logIndex = Number(data.logIndex);
  const chainId = Number(data.chainId);
  if (!txHash || txHash === "0x" || txHash.length < 10) return null;
  if (!eventKind) return null;
  if (!Number.isFinite(logIndex) || logIndex < 0) return null;
  if (!Number.isFinite(chainId) || chainId <= 0) return null;
  return { chainId, txHash, logIndex, eventKind };
}

export function createLiveSession(): LiveSession {
  return { cutoff: null, lastSseId: 0, seen: new Set() };
}

/** Process-wide session. Survives toast dismiss, stack cap, and component remount. */
let moduleSession: LiveSession = createLiveSession();

export function getLiveSession(): LiveSession {
  return moduleSession;
}

export function resetLiveSessionForTests(): void {
  moduleSession = createLiveSession();
}

export function rememberCanonical(session: LiveSession, key: string): LiveSession {
  if (session.seen.has(key)) return session;
  const seen = new Set(session.seen);
  seen.add(key);
  return { ...session, seen };
}

export function hasSeenCanonical(session: LiveSession, key: string): boolean {
  return session.seen.has(key);
}

export function markSeen(key: string): void {
  moduleSession = rememberCanonical(moduleSession, key);
}

export function noteSseId(session: LiveSession, sseId: number | undefined): LiveSession {
  const id = Number(sseId ?? 0);
  if (!Number.isFinite(id) || id <= session.lastSseId) return session;
  return { ...session, lastSseId: id };
}

/** First hello sets cutoff. Reconnect hello must not raise it (that drops missed live events). */
export function applyHello(session: LiveSession, hello: { head?: unknown; last?: unknown }): LiveSession {
  if (session.cutoff != null) return session;
  const head = Number(hello.head ?? hello.last ?? 0);
  return { ...session, cutoff: Number.isFinite(head) ? head : 0 };
}

export function streamEndpoint(base: string, after = 0): string {
  const root = base.replace(/\/$/, "");
  return after > 0 ? `${root}/stream?after=${after}` : `${root}/stream`;
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

/** Map a post-commit SSE event to a CORE / Top-10 toast. Requires canonical log identity. */
export function toastFromLiveEvent(ev: LiveStreamEvent): LiveToast | null {
  const data = ev.data ?? {};
  if (data.confirmed === false) return null;
  const identity = identityFromLiveData(data);
  if (!identity) return null;

  if (ev.type === "core") {
    if (!EXEC_CORE.has(identity.eventKind)) return null;
    return {
      id: canonicalEventKey(identity),
      kind: "core",
      title: "CORE buy+burn confirmed",
      body: formatCoreBody(data),
      tx: identity.txHash,
      identity,
    };
  }

  if (ev.type === "burn" && identity.eventKind === "Top10Buy") {
    return {
      id: canonicalEventKey(identity),
      kind: "top10",
      title: "Top-10 buy+burn confirmed",
      body: formatTop10Body(data),
      tx: identity.txHash,
      identity,
    };
  }

  return null;
}

export function acceptLiveToast(
  session: LiveSession,
  ev: LiveStreamEvent,
): { session: LiveSession; toast: LiveToast | null } {
  const next = noteSseId(session, ev.id);
  if (next.cutoff == null || !isLiveAfterHead(ev.id, next.cutoff)) {
    return { session: next, toast: null };
  }
  const toast = toastFromLiveEvent(ev);
  if (!toast) return { session: next, toast: null };
  if (hasSeenCanonical(next, toast.id)) return { session: next, toast: null };
  return { session: rememberCanonical(next, toast.id), toast };
}

/** First hello / later SSE through the module session. Seen-set is not the visible array. */
export function ingestLiveEvent(ev: LiveStreamEvent): LiveToast | null {
  if (ev.type === "hello") {
    moduleSession = applyHello(moduleSession, ev.data);
    return null;
  }
  if (ev.type === "error" || ev.type === "ping") return null;
  const { session, toast } = acceptLiveToast(moduleSession, ev);
  moduleSession = session;
  return toast;
}

/**
 * Display window only. Dedupe is `session.seen` in `acceptLiveToast` /
 * `ingestLiveEvent` — never reconstruct seen from this list.
 */
export function pushVisibleToast(visible: LiveToast[], next: LiveToast): LiveToast[] {
  if (visible.some((t) => t.id === next.id)) return visible;
  return [...visible, next].slice(-LIVE_TOAST_LIMIT);
}

export function createToastClock(now: number, remainingMs = LIVE_TOAST_MS): ToastClock {
  return { remainingMs, running: true, startedAt: now };
}

export function pauseToastClock(clock: ToastClock, now: number): ToastClock {
  if (!clock.running || clock.startedAt == null) {
    return { remainingMs: clock.remainingMs, running: false, startedAt: null };
  }
  return {
    remainingMs: Math.max(0, clock.remainingMs - (now - clock.startedAt)),
    running: false,
    startedAt: null,
  };
}

export function resumeToastClock(clock: ToastClock, now: number): ToastClock {
  if (clock.running) return clock;
  return { remainingMs: clock.remainingMs, running: true, startedAt: now };
}

export function clockExpired(clock: ToastClock, now: number): boolean {
  if (clock.remainingMs <= 0) return true;
  if (!clock.running || clock.startedAt == null) return false;
  return now - clock.startedAt >= clock.remainingMs;
}

export function prefersReducedMotion(media: { matches: boolean } | null | undefined): boolean {
  return Boolean(media?.matches);
}
