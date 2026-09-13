import { INDEXER_URL } from "./chain";

export type WalletProofHeader = { "x-reactor-wallet-proof": string };

export async function fetchWalletProofMessage(
  indexerUrl: string = INDEXER_URL,
): Promise<{ token: string; message: string; exp?: number }> {
  const res = await fetch(`${indexerUrl.replace(/\/$/, "")}/operator-policy/challenge`, {
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json()) as { token?: string; message?: string; exp?: number; error?: string };
  if (!res.ok || !json.token || !json.message) {
    throw new Error(json.error ?? "Wallet proof challenge unavailable");
  }
  const exp = typeof json.exp === "number" && Number.isFinite(json.exp) ? json.exp : undefined;
  return { token: json.token, message: json.message, exp };
}

export async function signOperatorWalletProof(
  signMessage: (message: string) => Promise<string>,
  indexerUrl: string = INDEXER_URL,
): Promise<WalletProofHeader> {
  const { token, message } = await fetchWalletProofMessage(indexerUrl);
  const signature = await signMessage(message);
  return { "x-reactor-wallet-proof": JSON.stringify({ token, signature }) };
}
