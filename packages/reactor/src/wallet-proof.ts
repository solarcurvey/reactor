/**
 * Server-issued EIP-191 wallet binding for operator-policy writes (issue #62).
 *
 * The screened subject is the recovered signer — never a browser-supplied
 * wallet / creator / recipient / x-reactor-wallet value.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress } from "viem";
import { normalizeEvmAddress } from "./sanctions-policy.ts";

export const WALLET_PROOF_PURPOSE = "operator-policy-write";
export const DEFAULT_WALLET_PROOF_TTL_SEC = 120;

export type WalletProofChallenge = {
  token: string;
  message: string;
  exp: number;
  nonce: string;
  chainId: number;
};

export type WalletProofOk = { ok: true; address: string; message: string };
export type WalletProofFail = {
  ok: false;
  reason: "wallet_missing" | "wallet_invalid" | "wallet_proof_stale";
};
export type WalletProofResult = WalletProofOk | WalletProofFail;

export function walletProofMessage(parts: { chainId: number; nonce: string; exp: number }): string {
  return [
    "REACTOR operator-policy v1",
    `purpose: ${WALLET_PROOF_PURPOSE}`,
    `chainId: ${parts.chainId}`,
    `nonce: ${parts.nonce}`,
    `exp: ${parts.exp}`,
  ].join("\n");
}

function macHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function macEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function issueWalletProofChallenge(opts: {
  chainId: number;
  secret: string;
  nowSec?: number;
  ttlSec?: number;
}): WalletProofChallenge {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const exp = now + (opts.ttlSec ?? DEFAULT_WALLET_PROOF_TTL_SEC);
  const nonce = randomBytes(16).toString("hex");
  const message = walletProofMessage({ chainId: opts.chainId, nonce, exp });
  const mac = macHex(opts.secret, message);
  return {
    token: `v1.${opts.chainId}.${exp}.${nonce}.${mac}`,
    message,
    exp,
    nonce,
    chainId: opts.chainId,
  };
}

export function parseWalletProofToken(token: string): {
  chainId: number;
  exp: number;
  nonce: string;
  mac: string;
} | null {
  const parts = token.trim().split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const chainId = Number(parts[1]);
  const exp = Number(parts[2]);
  const nonce = parts[3] ?? "";
  const mac = parts[4] ?? "";
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  if (!Number.isInteger(exp) || exp <= 0) return null;
  if (!/^[0-9a-f]{32}$/.test(nonce)) return null;
  if (!/^[0-9a-f]{64}$/.test(mac)) return null;
  return { chainId, exp, nonce, mac };
}

export async function recoverWalletProof(input: {
  token: string;
  signature: string;
  secret: string;
  expectedChainId: number;
  nowSec?: number;
}): Promise<WalletProofResult> {
  if (!input.token?.trim() || !input.signature?.trim()) {
    return { ok: false, reason: "wallet_missing" };
  }
  const parsed = parseWalletProofToken(input.token);
  if (!parsed) return { ok: false, reason: "wallet_invalid" };
  if (parsed.chainId !== input.expectedChainId) return { ok: false, reason: "wallet_invalid" };
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (parsed.exp < now) return { ok: false, reason: "wallet_proof_stale" };
  const message = walletProofMessage({ chainId: parsed.chainId, nonce: parsed.nonce, exp: parsed.exp });
  const expected = macHex(input.secret, message);
  if (!macEqual(parsed.mac, expected)) return { ok: false, reason: "wallet_invalid" };
  try {
    const recovered = await recoverMessageAddress({
      message,
      signature: input.signature as `0x${string}`,
    });
    const address = normalizeEvmAddress(recovered);
    if (!address) return { ok: false, reason: "wallet_invalid" };
    return { ok: true, address, message };
  } catch {
    return { ok: false, reason: "wallet_invalid" };
  }
}

export type WalletProofParts = { token: string; signature: string };

export function readWalletProofParts(input: {
  headerProof?: string;
  body?: Record<string, unknown>;
}): WalletProofParts | undefined {
  const fromHeader = parseProofJson(input.headerProof);
  if (fromHeader) return fromHeader;
  const body = input.body ?? {};
  for (const key of ["walletProof", "operatorProof", "proof"] as const) {
    const raw = body[key];
    if (raw && typeof raw === "object") {
      const o = raw as { token?: unknown; signature?: unknown };
      if (typeof o.token === "string" && typeof o.signature === "string") {
        return { token: o.token, signature: o.signature };
      }
    }
  }
  if (typeof body.walletProofToken === "string" && typeof body.walletProofSignature === "string") {
    return { token: body.walletProofToken, signature: body.walletProofSignature };
  }
  return undefined;
}

function parseProofJson(raw: string | undefined): WalletProofParts | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const o = JSON.parse(raw) as { token?: unknown; signature?: unknown };
    if (typeof o.token === "string" && typeof o.signature === "string") {
      return { token: o.token, signature: o.signature };
    }
  } catch {
    /* compact token\nsig */
  }
  const nl = raw.indexOf("\n");
  if (nl > 0) {
    return { token: raw.slice(0, nl).trim(), signature: raw.slice(nl + 1).trim() };
  }
  return undefined;
}
