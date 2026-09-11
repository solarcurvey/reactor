import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(addr?: string, size = 4) {
  if (!addr) return "—";
  return `${addr.slice(0, 2 + size)}…${addr.slice(-size)}`;
}

export function formatUnitsSafe(value: bigint, decimals: number, digits = 4) {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
  const body = fracStr.length ? `${whole.toString()}.${fracStr}` : whole.toString();
  return neg ? `-${body}` : body;
}

export function parseUnitsSafe(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!trimmed || trimmed === ".") return 0n;
  const [w, f = ""] = trimmed.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function feeSplit(notional: bigint) {
  const holders = (notional * 200n) / 10_000n;
  const buyback = (notional * 100n) / 10_000n;
  return { holders, buyback, fee: holders + buyback };
}

export function explorerTx(hash: string) {
  const base = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://testnet.arcscan.app";
  return `${base}/tx/${hash}`;
}

export function explorerAddress(addr: string) {
  const base = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://testnet.arcscan.app";
  return `${base}/address/${addr}`;
}
