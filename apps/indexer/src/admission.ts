import { createHash, randomBytes } from "node:crypto";
import { keccak256, toBytes } from "viem";
import type { Store } from "./db.ts";
import {
  evaluateAdmission,
  type AdmissionDecision,
  type IssuanceLevel,
} from "../../../packages/reactor/src/admission.ts";
import { isReservedTicker, normalizeTicker, tryNormalizeTicker } from "../../../packages/reactor/src/ticker.ts";

const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

export function issuanceLevel(): IssuanceLevel {
  const env = (process.env.ISSUANCE_LEVEL ?? "NORMAL").toUpperCase();
  if (env === "ELEVATED" || env === "ATTACK") return env;
  return "NORMAL";
}

function rate(key: string, max: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  return arr.length <= max;
}

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return (process.env.REACTOR_ENV ?? "").toUpperCase() === "LOCAL" || !process.env.TURNSTILE_REQUIRED;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const json = (await res.json()) as { success?: boolean };
    return Boolean(json.success);
  } catch {
    return false;
  }
}

export async function admit(
  store: Store,
  input: {
    ticker?: string;
    quote?: string;
    factory?: string;
    name?: string;
    description?: string;
    imageHash?: string;
    wallet?: string;
    session?: string;
    ip?: string;
    asn?: string;
    turnstile?: string;
  },
): Promise<{ decision: AdmissionDecision; reasons: string[]; level: IssuanceLevel; ticker?: string; challenge?: string }> {
  const level = issuanceLevel();
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

  const turnstileOk = await verifyTurnstile(input.turnstile, input.ip ?? "");
  const ipOk = rate(`ip:${input.ip ?? "x"}`, level === "ATTACK" ? 2 : level === "ELEVATED" ? 8 : 40);
  const walOk = rate(`w:${(input.wallet ?? "x").toLowerCase()}`, level === "ATTACK" ? 1 : 6);
  const imgOk = !input.imageHash || rate(`img:${input.imageHash}`, 3);
  const cluster = createHash("sha256").update(`${input.wallet ?? ""}:${input.asn ?? input.ip ?? ""}`).digest("hex").slice(0, 12);

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
      turnstileOk,
      fundedCluster: cluster,
      recentLaunches: ipOk && walOk ? 0 : 99,
    },
    level,
  );
  if (!imgOk) ev.reasons.push("image-hash cluster");
  if (!ipOk) ev.reasons.push("ip rate");
  if (ev.reasons.length) ev.decision = ev.decision === "ALLOW" ? "CHALLENGE" : ev.decision;
  if (level === "ATTACK") ev.decision = ev.decision === "ALLOW" ? "CHALLENGE" : ev.decision;

  await store.run(
    `INSERT INTO launch_auths(digest, auth_id, creator, ticker, quote, factory, decision, ts) VALUES(?,?,?,?,?,?,?,?)`,
    `admit:${randomBytes(8).toString("hex")}`,
    "",
    (input.wallet ?? "").toLowerCase(),
    parsed.ticker,
    (input.quote ?? "").toLowerCase(),
    (input.factory ?? "").toLowerCase(),
    ev.decision,
    Math.floor(Date.now() / 1000),
  );

  return { ...ev, ticker: parsed.ticker, challenge: ev.challenge };
}

export function imageHash(buf: Buffer): string {
  return keccak256(new Uint8Array(buf));
}

export { normalizeTicker, tryNormalizeTicker };
