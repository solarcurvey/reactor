import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { keccak256 } from "viem";
import type { Store } from "./db.ts";
import {
  evaluateAdmission,
  issuanceFromCounts,
  type AdmissionDecision,
  type IssuanceLevel,
} from "../../../packages/reactor/src/admission.ts";
import { isReservedTicker, normalizeTicker, tryNormalizeTicker } from "../../../packages/reactor/src/ticker.ts";

const WINDOW_MS = 60 * 60 * 1000;
const RECEIPT_TTL_SEC = 5 * 60;

export type AdmitInput = {
  ticker?: string;
  quote?: string;
  factory?: string;
  name?: string;
  description?: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  imageHash?: string;
  wallet?: string;
  session?: string;
  ip?: string;
  asn?: string;
  client?: string;
  turnstile?: string;
};

export type AdmitResult = {
  decision: AdmissionDecision;
  reasons: string[];
  level: IssuanceLevel;
  ticker?: string;
  challenge?: string;
  receipt?: string;
  receiptId?: string;
};

function localEnv(): boolean {
  return (process.env.REACTOR_ENV ?? "").toUpperCase() === "LOCAL";
}

function hmacSecret(): string {
  const s = process.env.ADMISSION_HMAC_SECRET;
  if (s && s.length >= 16) return s;
  if (localEnv()) return "local-admission-hmac-do-not-use-in-prod";
  throw new Error("ADMISSION_HMAC_SECRET required");
}

export async function issuanceLevel(store: Store): Promise<IssuanceLevel> {
  const hourAgo = Date.now() - WINDOW_MS;
  const row = await store.get<{ n: number }>(
    "SELECT COUNT(*) as n FROM admission_hits WHERE key=? AND ts>=?",
    "global:allow",
    hourAgo,
  );
  const computed = issuanceFromCounts(Number(row?.n ?? 0), process.env.ISSUANCE_LEVEL);
  await store.run(
    "INSERT INTO issuance_state(k,v,ts) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, ts=excluded.ts",
    "level",
    computed,
    Math.floor(Date.now() / 1000),
  );
  return computed;
}

async function hit(store: Store, key: string): Promise<number> {
  const now = Date.now();
  await store.run("DELETE FROM admission_hits WHERE ts < ?", now - WINDOW_MS);
  await store.run("INSERT INTO admission_hits(key, ts) VALUES(?,?)", key, now);
  const row = await store.get<{ n: number }>("SELECT COUNT(*) as n FROM admission_hits WHERE key=? AND ts>=?", key, now - WINDOW_MS);
  return Number(row?.n ?? 0);
}

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<{ ok: boolean; wired: boolean }> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    if (localEnv() && process.env.TURNSTILE_REQUIRED !== "1") return { ok: true, wired: false };
    return { ok: false, wired: false };
  }
  if (!token) return { ok: false, wired: true };
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const json = (await res.json()) as { success?: boolean };
    return { ok: Boolean(json.success), wired: true };
  } catch {
    return { ok: false, wired: true };
  }
}

export function fundingCluster(wallet?: string, asn?: string, ip?: string): string {
  return createHash("sha256")
    .update(`${(wallet ?? "").toLowerCase()}|${asn ?? ""}|${(ip ?? "").split(".").slice(0, 2).join(".")}`)
    .digest("hex")
    .slice(0, 16);
}

export function issueReceipt(payload: Record<string, unknown>): { receipt: string; id: string } {
  const id = randomBytes(16).toString("hex");
  const body = { ...payload, id, exp: Math.floor(Date.now() / 1000) + RECEIPT_TTL_SEC };
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const mac = createHmac("sha256", hmacSecret()).update(payloadB64).digest("base64url");
  return { receipt: `${payloadB64}.${mac}`, id };
}

export function verifyReceipt(receipt: string): Record<string, unknown> | null {
  const [payloadB64, mac] = receipt.split(".");
  if (!payloadB64 || !mac) return null;
  const expect = createHmac("sha256", hmacSecret()).update(payloadB64).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<string, unknown>;
    if (body.decision !== "ALLOW") return null;
    if (Number(body.exp ?? 0) < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

export async function consumeReceipt(store: Store, id: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const row = await store.get<{ consumed: number; expires: number }>(
    "SELECT consumed, expires FROM admission_receipts WHERE id=?",
    id,
  );
  if (row && Number(row.consumed) === 1) return false;
  if (row && Number(row.expires) > 0 && Number(row.expires) < now) return false;
  if (!row) {
    await store.run(
      `INSERT INTO admission_receipts(id, hmac, payload, consumed, expires, ts) VALUES(?,?,?,?,?,?)`,
      id,
      "",
      "consume",
      1,
      now + RECEIPT_TTL_SEC,
      now,
    );
    return true;
  }
  await store.run("UPDATE admission_receipts SET consumed=1 WHERE id=? AND consumed=0", id);
  return true;
}

export async function admit(store: Store, input: AdmitInput): Promise<AdmitResult> {
  const level = await issuanceLevel(store);
  const parsed = tryNormalizeTicker(input.ticker ?? "");
  if (!parsed.ok) return { decision: "DENY", reasons: [parsed.reason], level };
  if (isReservedTicker(parsed.ticker)) return { decision: "DENY", reasons: ["reserved ticker"], level, ticker: parsed.ticker };

  const row = await store.get<{ permanent: number; locked_until: number; token: string }>(
    "SELECT permanent, locked_until, token FROM tickers WHERE ticker=?",
    parsed.ticker,
  );
  if (row?.permanent) return { decision: "DENY", reasons: ["permanently locked"], level, ticker: parsed.ticker };
  if (row && Number(row.locked_until) > Date.now() / 1000) {
    return { decision: "DENY", reasons: ["24h ticker lock"], level, ticker: parsed.ticker };
  }

  const turnstile = await verifyTurnstile(input.turnstile, input.ip ?? "");
  const ipHits = await hit(store, `ip:${input.ip ?? "x"}`);
  const walHits = await hit(store, `w:${(input.wallet ?? "x").toLowerCase()}`);
  const sessHits = await hit(store, `s:${input.session ?? input.client ?? "anon"}`);
  const clientHits = await hit(store, `c:${input.client ?? input.ip ?? "x"}`);
  const imgHits = input.imageHash ? await hit(store, `img:${input.imageHash}`) : 0;
  if (input.imageHash) {
    await store.run(
      `INSERT INTO admission_image_hashes(hash, first_seen, count) VALUES(?,?,1)
       ON CONFLICT(hash) DO UPDATE SET count=admission_image_hashes.count+1`,
      input.imageHash,
      Math.floor(Date.now() / 1000),
    );
  }
  const cluster = fundingCluster(input.wallet, input.asn, input.ip);
  const clusterHits = await hit(store, `cluster:${cluster}`);

  const ev = evaluateAdmission(
    {
      ticker: parsed.ticker,
      quote: input.quote,
      factory: input.factory,
      metadata: { name: input.name, description: input.description, imageHash: input.imageHash },
      wallet: input.wallet,
      session: input.session,
      ip: input.ip,
      asn: input.asn,
      client: input.client,
      turnstileOk: turnstile.ok,
      turnstileRequired: turnstile.wired || process.env.TURNSTILE_REQUIRED === "1",
      fundedCluster: cluster,
      clusterLaunches: clusterHits,
      recentLaunches: Math.max(ipHits, walHits, clientHits),
      imageHashRepeats: imgHits,
      sessionHits: sessHits,
      ipHits,
      walletHits: walHits,
    },
    level,
  );

  if (ev.decision === "CHALLENGE") {
    await store.run(
      `INSERT INTO admission_challenges(id, wallet, session, ip, ticker, status, created_ts) VALUES(?,?,?,?,?,?,?)`,
      randomBytes(8).toString("hex"),
      (input.wallet ?? "").toLowerCase(),
      input.session ?? "",
      input.ip ?? "",
      parsed.ticker,
      "open",
      Math.floor(Date.now() / 1000),
    );
  }

  let receipt: string | undefined;
  let receiptId: string | undefined;
  if (ev.decision === "ALLOW") {
    await hit(store, "global:allow");
    const issued = issueReceipt({
      decision: "ALLOW",
      ticker: parsed.ticker,
      quote: (input.quote ?? "").toLowerCase(),
      factory: (input.factory ?? "").toLowerCase(),
      creator: (input.wallet ?? "").toLowerCase(),
      name: input.name ?? "",
      imageHash: input.imageHash ?? "",
      cluster,
    });
    receipt = issued.receipt;
    receiptId = issued.id;
    await store.run(
      `INSERT INTO admission_receipts(id, hmac, payload, consumed, expires, ts) VALUES(?,?,?,?,?,?)`,
      issued.id,
      issued.receipt,
      JSON.stringify({ ticker: parsed.ticker, wallet: input.wallet, quote: input.quote }),
      0,
      Math.floor(Date.now() / 1000) + RECEIPT_TTL_SEC,
      Math.floor(Date.now() / 1000),
    );
  }

  await store.run(
    `INSERT INTO launch_auths(digest, auth_id, creator, ticker, quote, factory, decision, ts) VALUES(?,?,?,?,?,?,?,?)`,
    `admit:${randomBytes(8).toString("hex")}`,
    receiptId ?? "",
    (input.wallet ?? "").toLowerCase(),
    parsed.ticker,
    (input.quote ?? "").toLowerCase(),
    (input.factory ?? "").toLowerCase(),
    ev.decision,
    Math.floor(Date.now() / 1000),
  );

  return { ...ev, ticker: parsed.ticker, challenge: ev.challenge, receipt, receiptId };
}

export function imageHash(buf: Buffer): string {
  return keccak256(new Uint8Array(buf));
}

export { normalizeTicker, tryNormalizeTicker };
