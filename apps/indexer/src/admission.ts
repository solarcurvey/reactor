import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { keccak256 } from "viem";
import type { Store } from "./db.ts";
import {
  evaluateAdmission,
  issuanceFromCounts,
  ISSUANCE_CAP,
  type AdmissionDecision,
  type IssuanceLevel,
} from "../../../packages/reactor/src/admission.ts";
import { isReservedTicker, normalizeTicker, tryNormalizeTicker } from "../../../packages/reactor/src/ticker.ts";
import {
  INSTANT_CURVE_V1,
  authMode,
  fairCurveConfig,
  hashMetadata,
  launchConfigHash,
  resolveFairParams,
} from "../../../packages/reactor/src/launch-auth.ts";
import { redisConsumeToken } from "./redis-bucket.ts";
import deployment from "./deployment.json" with { type: "json" };

const DEFAULT_FACTORY = ((deployment as { addresses?: Record<string, string> }).addresses?.ReactorFactory ??
  "0x0000000000000000000000000000000000000000").toLowerCase();

const WINDOW_MS = 60 * 60 * 1000;
const RECEIPT_TTL_SEC = 5 * 60;

export type AdmitInput = {
  ticker?: string;
  quote?: string;
  factory?: string;
  factoryVersion?: number;
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
  mode?: string;
  supply?: string | number;
  decimals?: number;
  duration?: number;
  auctionBps?: number;
  minRaise?: string | number;
};

export type AdmitResult = {
  decision: AdmissionDecision;
  reasons: string[];
  level: IssuanceLevel;
  ticker?: string;
  challenge?: string;
  receipt?: string;
  receiptId?: string;
  launchConfigHash?: string;
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

export async function signedAuthCount(store: Store): Promise<number> {
  const hourAgo = Date.now() - WINDOW_MS;
  const row = await store.get<{ n: number }>(
    "SELECT COUNT(*) as n FROM admission_hits WHERE key=? AND ts>=?",
    "global:signed-auth",
    hourAgo,
  );
  return Number(row?.n ?? 0);
}

export async function issuanceLevel(store: Store): Promise<IssuanceLevel> {
  const computed = issuanceFromCounts(await signedAuthCount(store), process.env.ISSUANCE_LEVEL);
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

export async function peekIssuanceTokens(store: Store, level: IssuanceLevel): Promise<number> {
  const cap = ISSUANCE_CAP[level];
  const now = Date.now();
  const row = await store.get<{ tokens: string; updated_ms: number }>("SELECT tokens, updated_ms FROM issuance_bucket WHERE k=?", "global");
  if (!row) return cap;
  const tokens = Number(row.tokens);
  const updated = Number(row.updated_ms);
  return Math.min(cap, tokens + ((now - updated) * cap) / WINDOW_MS);
}

/** Atomic token-bucket consume. Counts a signed LaunchAuthorization. */
export async function consumeIssuanceToken(store: Store): Promise<{ ok: boolean; level: IssuanceLevel; signed: number }> {
  const redis = await redisConsumeToken(ISSUANCE_CAP.NORMAL, WINDOW_MS);
  return store.transaction(async (tx) => {
    const level = await issuanceLevel(tx);
    const cap = ISSUANCE_CAP[level];
    const now = Date.now();
    const row = await tx.get<{ tokens: string; updated_ms: number; signed_count: number }>(
      "SELECT tokens, updated_ms, signed_count FROM issuance_bucket WHERE k=?",
      "global",
    );
    let tokens = row ? Number(row.tokens) : cap;
    const updated = row ? Number(row.updated_ms) : now;
    const signed = row ? Number(row.signed_count) : 0;
    tokens = Math.min(cap, tokens + ((now - updated) * cap) / WINDOW_MS);
    if (redis === false || tokens < 1) return { ok: false, level, signed };
    tokens -= 1;
    await tx.run(
      `INSERT INTO issuance_bucket(k,tokens,updated_ms,signed_count) VALUES(?,?,?,?)
       ON CONFLICT(k) DO UPDATE SET tokens=excluded.tokens, updated_ms=excluded.updated_ms, signed_count=excluded.signed_count`,
      "global",
      String(tokens),
      now,
      signed + 1,
    );
    await tx.run("INSERT INTO admission_hits(key, ts) VALUES(?,?)", "global:signed-auth", now);
    return { ok: true, level, signed: signed + 1 };
  });
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

/** Network-rename heuristic: ASN + IPv4 /16. Not KYC. */
export function networkCluster(asn?: string, ip?: string): string {
  const v4 = (ip ?? "").split(".").slice(0, 2).join(".");
  return createHash("sha256").update(`net|${asn ?? ""}|${v4}`).digest("hex").slice(0, 16);
}

/** Lightweight onchain funder: first USDC Transfer `from` in a bounded lookback. Not chain-analysis. */
export async function onchainFunderSignal(wallet?: string): Promise<string | undefined> {
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return undefined;
  const rpc = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
  const usdc = process.env.USDC_ADDRESS;
  if (!rpc || !usdc) return undefined;
  try {
    const topicTo = `0x${wallet.slice(2).toLowerCase().padStart(64, "0")}`;
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [
          {
            address: usdc,
            topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", null, topicTo],
            fromBlock: "earliest",
            toBlock: "latest",
          },
        ],
      }),
      signal: AbortSignal.timeout(4_000),
    });
    const j = (await res.json()) as { result?: Array<{ topics?: string[] }> };
    const first = j.result?.[0];
    const from = first?.topics?.[1];
    if (!from) return undefined;
    return `0x${from.slice(26).toLowerCase()}`;
  } catch {
    return undefined;
  }
}

export function fundingCluster(wallet?: string, asn?: string, ip?: string, funder?: string): string {
  if (funder) {
    return createHash("sha256").update(`funder|${funder.toLowerCase()}`).digest("hex").slice(0, 16);
  }
  return createHash("sha256")
    .update(`wallet|${(wallet ?? "").toLowerCase()}|${networkCluster(asn, ip)}`)
    .digest("hex")
    .slice(0, 16);
}

export function identityCurveConfig(input: AdmitInput): `0x${string}` {
  const path = input.mode === "fair" ? "fair" : input.mode === "standard" ? "standard" : "rewards";
  if (path === "fair") {
    const p = resolveFairParams({
      supply: input.supply,
      decimals: input.decimals,
      duration: input.duration,
      auctionBps: input.auctionBps,
      minRaise: input.minRaise,
    });
    return fairCurveConfig(p.supply, p.decimals, p.duration, p.auctionBps, p.minRaise);
  }
  return INSTANT_CURVE_V1;
}

export function computeLaunchConfigHash(input: AdmitInput, ticker: string): `0x${string}` {
  const path = input.mode === "fair" ? "fair" : input.mode === "standard" ? "standard" : "rewards";
  const metadataHash = hashMetadata(
    input.image ?? "",
    input.description ?? "",
    input.website ?? "",
    input.twitter ?? "",
    input.telegram ?? "",
  );
  return launchConfigHash({
    creator: (input.wallet ?? "0x0000000000000000000000000000000000000000").toLowerCase(),
    ticker,
    name: input.name ?? ticker,
    metadataHash,
    quote: (input.quote ?? "0x0000000000000000000000000000000000000000").toLowerCase(),
    mode: authMode(path),
    factory: (input.factory ?? DEFAULT_FACTORY).toLowerCase(),
    factoryVersion: input.factoryVersion ?? 1,
    curveConfig: identityCurveConfig(input),
  });
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
  if (store.dialect === "postgres") {
    const row = await store.get<{ id: string }>(
      "UPDATE admission_receipts SET consumed=1 WHERE id=? AND consumed=0 AND (expires=0 OR expires>=?) RETURNING id",
      id,
      now,
    );
    return Boolean(row?.id);
  }
  return store.transaction(async (tx) => {
    const r = await tx.runChanges(
      "UPDATE admission_receipts SET consumed=1 WHERE id=? AND consumed=0 AND (expires=0 OR expires>=?)",
      id,
      now,
    );
    return r.changes === 1;
  });
}

export async function persistReceipt(store: Store, issued: { id: string; receipt: string }, payload: unknown, expires: number) {
  await store.run(
    `INSERT INTO admission_receipts(id, hmac, payload, consumed, expires, ts) VALUES(?,?,?,?,?,?)`,
    issued.id,
    issued.receipt,
    JSON.stringify(payload),
    0,
    expires,
    Math.floor(Date.now() / 1000),
  );
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
  const imgHits = input.imageHash ? await hit(store, `img:${input.imageHash}`) : 0;
  if (input.imageHash) {
    await store.run(
      `INSERT INTO admission_image_hashes(hash, first_seen, count) VALUES(?,?,1)
       ON CONFLICT(hash) DO UPDATE SET count=admission_image_hashes.count+1`,
      input.imageHash,
      Math.floor(Date.now() / 1000),
    );
  }
  const funder = await onchainFunderSignal(input.wallet);
  const cluster = fundingCluster(input.wallet, input.asn, input.ip, funder);
  const clusterHits = await hit(store, `cluster:${cluster}`);
  const signed = await signedAuthCount(store);
  const tokens = await peekIssuanceTokens(store, level);

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
      recentSignedAuths: signed,
      imageHashRepeats: imgHits,
      sessionHits: sessHits,
      ipHits,
      walletHits: walHits,
      issuanceTokens: tokens,
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
  let cfgHash: string | undefined;
  if (ev.decision === "ALLOW") {
    cfgHash = computeLaunchConfigHash(input, parsed.ticker);
    const issued = issueReceipt({
      decision: "ALLOW",
      ticker: parsed.ticker,
      quote: (input.quote ?? "").toLowerCase(),
      factory: (input.factory ?? "").toLowerCase(),
      factoryVersion: input.factoryVersion ?? 1,
      creator: (input.wallet ?? "").toLowerCase(),
      name: input.name ?? "",
      imageHash: input.imageHash ?? "",
      mode: input.mode ?? "rewards",
      curveConfig: identityCurveConfig(input),
      launchConfigHash: cfgHash,
      cluster,
      funder: funder ?? "",
      networkCluster: networkCluster(input.asn, input.ip),
    });
    receipt = issued.receipt;
    receiptId = issued.id;
    await persistReceipt(
      store,
      issued,
      { ticker: parsed.ticker, wallet: input.wallet, quote: input.quote, launchConfigHash: cfgHash },
      Math.floor(Date.now() / 1000) + RECEIPT_TTL_SEC,
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

  return { ...ev, ticker: parsed.ticker, challenge: ev.challenge, receipt, receiptId, launchConfigHash: cfgHash };
}

export function imageHash(buf: Buffer): string {
  return keccak256(new Uint8Array(buf));
}

export { normalizeTicker, tryNormalizeTicker };
